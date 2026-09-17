import {
  AccountAccessExpiredError,
  AccountNotProfessionalError,
  AccountNotTesterError,
  ConnectionInvalidError,
  InstagramUnavailableError,
} from "../common/errors";
import { MetaRefusedError } from "./client";

/**
 * Traduz a recusa da Meta para algo que a pessoa consiga resolver (docs/08).
 *
 * Mora aqui, e não no cliente, porque **o mesmo código numérico quer dizer
 * coisas diferentes conforme o momento**. A `origin` é o que dá esse contexto:
 *
 * - `"conexao"` — a pessoa está conectando a conta agora. Um token recusado
 *   quase sempre quer dizer que o app, em desenvolvimento, não conhece aquela
 *   conta como testadora.
 * - `"uso"` — a conta já estava conectada e estamos usando o token guardado.
 *   Aqui a mesma recusa quer dizer que o acesso morreu: a pessoa revogou o app,
 *   trocou a senha, ou o token passou dos 60 dias.
 *
 * Sem essa distinção, a renovação de token do worker diria "esta conta ainda não
 * aceitou o convite de testadora" para uma conta conectada há meses.
 *
 * ⚠️ **A mensagem da Meta nunca é repassada.** Ela devolve de volta o que
 * recebeu, token incluído (AGENTS.md, regra 3). Só o código numérico atravessa.
 */
export type RefusalOrigin = "conexao" | "uso";

export function translateRefusal(error: unknown, origin: RefusalOrigin): Error {
  if (!(error instanceof MetaRefusedError)) {
    return error instanceof Error ? error : new InstagramUnavailableError();
  }

  const { code, subcode } = error.meta;

  // 100 é "parâmetro inválido" no vocabulário da Meta, e no fluxo de conexão o
  // culpado é quase sempre um destes três: código de autorização já usado (F5 na
  // volta), código vencido depois de uma hora, ou a URI de retorno diferente da
  // cadastrada no painel — inclusive por uma barra final que o painel acrescenta
  // sozinho (docs/08). Dizer "o Instagram não respondeu" aqui manda a pessoa
  // procurar problema de rede enquanto a causa está na tela dela.
  if (code === 100 && subcode !== 33) return new ConnectionInvalidError();

  // 100 com subcódigo 33 é "objeto não existe ou você não pode vê-lo" — conta
  // pessoal, que o Instagram Login não enxerga.
  if (code === 100 && subcode === 33) return new AccountNotProfessionalError();

  // 190 é "token inválido"; 10 e 200 são a família "sem permissão para esta
  // ação". O que eles querem dizer depende de quando aconteceram.
  if (code === 190 || code === 102 || code === 10 || code === 200) {
    return origin === "conexao" ? new AccountNotTesterError() : new AccountAccessExpiredError();
  }

  return new InstagramUnavailableError();
}
