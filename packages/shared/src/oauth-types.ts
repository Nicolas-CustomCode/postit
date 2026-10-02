/**
 * O contrato da tela de permissão do assistente (ADR 0029), entre o Next e a API.
 *
 * Os nomes com sublinhado são os do OAuth (RFC 6749, RFC 7636, RFC 8707) e ficam
 * como o protocolo os define — como os da Meta (ADR 0023).
 */
import { z } from "zod";

/** O único escopo que existe: compor rascunhos (ADR 0029, decisão 4). */
export const OAUTH_SCOPE = "postagens:compor";

const param = (max: number) => z.string().max(max).optional();

/**
 * O pedido de autorização como chega na URL da tela. `object`, e não
 * `strictObject`: o OAuth manda ignorar parâmetro desconhecido, e o cliente pode
 * mandar `prompt` ou outros que não usamos.
 */
export const oauthAuthorizeSchema = z.object({
  client_id: z.string().min(1).max(2048),
  redirect_uri: param(2048),
  response_type: param(64),
  code_challenge: param(128),
  code_challenge_method: param(16),
  scope: param(256),
  state: param(1024),
  resource: param(2048),
});
export type OAuthAuthorizeInput = z.infer<typeof oauthAuthorizeSchema>;

/**
 * O que a tela faz com o pedido:
 *  - INVALID: cliente ou endereço de retorno que não confere. Mostra o motivo e
 *    para — redirecionar seria abrir um redirecionamento a serviço de quem forjou o link;
 *  - REDIRECT: o endereço é confiável, e o erro volta ao cliente por ele;
 *  - READY: pergunta à pessoa. `denyRedirect` é para onde vai o "Recusar".
 */
export type OAuthRequestDescription =
  | { readonly kind: "INVALID"; readonly reason: string }
  | { readonly kind: "REDIRECT"; readonly redirectTo: string }
  | {
      readonly kind: "READY";
      readonly clientName: string;
      /** O domínio para onde a pessoa volta — é o que ela confere contra phishing. */
      readonly redirectHost: string;
      /** Sem `POSTAGEM_EDITAR`, a tela explica e só oferece recusar. */
      readonly canAuthorize: boolean;
      readonly denyRedirect: string;
    };

export interface OAuthApproval {
  readonly redirectTo: string;
}

/** Um assistente que a pessoa autorizou, no cartão "Aplicativos conectados" do Perfil. */
export interface ConnectedApp {
  readonly id: string;
  readonly clientName: string;
  readonly createdAt: string;
  readonly lastUsedAt: string;
}

/**
 * O id que vem no caminho de `POST /oauth/grants/:id/revoke`. A coluna é `@db.Uuid`:
 * fora do formato, o Prisma estouraria e a rota responderia 500 no lugar de 400.
 */
export const connectedAppIdSchema = z.string().uuid();
