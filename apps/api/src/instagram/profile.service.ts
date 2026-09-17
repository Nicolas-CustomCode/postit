import { Injectable } from "@nestjs/common";
import {
  AccountNotProfessionalError,
  AccountNotTesterError,
  InstagramUnavailableError,
} from "../common/errors";
import { InstagramClient, MetaRefusedError } from "./client";

/**
 * Leitura do perfil da conta conectada (docs/08, "Dados do perfil").
 *
 * Os nomes dos campos são os que a Meta define — `account_type`,
 * `profile_picture_url`, `followers_count` — e ficam como ela os escreve
 * (AGENTS.md, "As exceções").
 */
const FIELDS = "user_id,username,name,account_type,profile_picture_url,followers_count,follows_count,media_count";

/** Os dois tipos que o Instagram Login aceita. Conta pessoal não entra. */
const PROFESSIONAL = new Set(["BUSINESS", "MEDIA_CREATOR"]);

export interface InstagramProfile {
  /** O id que a Meta usa para esta conta — vai para `Conta.idExterno`. */
  readonly externalId: string;
  readonly username: string;
  readonly name: string | null;
  readonly photoUrl: string | null;
  readonly followersCount: number | null;
  readonly followsCount: number | null;
  readonly mediaCount: number | null;
}

interface MeResponse {
  readonly id?: string;
  readonly user_id?: string;
  readonly username?: string;
  readonly name?: string;
  readonly account_type?: string;
  readonly profile_picture_url?: string;
  readonly followers_count?: number;
  readonly follows_count?: number;
  readonly media_count?: number;
}

@Injectable()
export class InstagramProfileService {
  constructor(private readonly client: InstagramClient) {}

  async read(token: string): Promise<InstagramProfile> {
    let dados: MeResponse;

    try {
      dados = await this.client.get<MeResponse>("/me", token, { fields: FIELDS });
    } catch (error) {
      throw translateRefusal(error);
    }

    // `account_type` só vem quando a conta é profissional o bastante para
    // tê-lo; ausente, não concluímos nada — a autorização já teria falhado.
    if (dados.account_type !== undefined && !PROFESSIONAL.has(dados.account_type)) {
      throw new AccountNotProfessionalError();
    }

    const externalId = dados.user_id ?? dados.id;
    if (externalId === undefined || dados.username === undefined) throw new InstagramUnavailableError();

    return {
      externalId,
      username: dados.username,
      name: dados.name ?? null,
      photoUrl: dados.profile_picture_url ?? null,
      followersCount: dados.followers_count ?? null,
      followsCount: dados.follows_count ?? null,
      mediaCount: dados.media_count ?? null,
    };
  }
}

/**
 * Traduz a recusa da Meta para algo que a pessoa consiga resolver.
 *
 * A tradução mora aqui, e não no cliente, porque só quem conhece o contexto sabe
 * que "código 190 durante a conexão" quer dizer "a conta não aceitou o convite
 * de testadora". **A mensagem da Meta nunca é repassada** — ela devolve de volta
 * o que recebeu, token incluído (AGENTS.md, regra 3).
 */
export function translateRefusal(error: unknown): Error {
  if (!(error instanceof MetaRefusedError)) {
    return error instanceof Error ? error : new InstagramUnavailableError();
  }

  const { code, subcode } = error.meta;

  // 190 é "token inválido" no vocabulário da Meta. Durante a conexão, com um
  // token recém-emitido, o motivo real é quase sempre o app em desenvolvimento
  // não conhecer aquela conta como testadora (docs/08, "Níveis de acesso").
  if (code === 190) return new AccountNotTesterError();

  // 10 e 200 são a família "sem permissão para esta ação": o app não tem acesso
  // àquela conta, que é o mesmo sintoma do convite não aceito.
  if (code === 10 || code === 200) return new AccountNotTesterError();

  // 100 com subcódigo 33 é "objeto não existe ou você não pode vê-lo" — conta
  // pessoal, que o Instagram Login não enxerga.
  if (code === 100 && subcode === 33) return new AccountNotProfessionalError();

  return new InstagramUnavailableError();
}
