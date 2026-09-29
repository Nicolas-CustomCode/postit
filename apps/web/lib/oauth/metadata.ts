import "server-only";
import { OAUTH_SCOPE } from "@repo/shared";

/**
 * Os documentos de descoberta do OAuth do assistente (ADR 0029). O cliente MCP chega
 * ao `/mcp`, recebe 401 com o endereço do primeiro, e dele acha o segundo.
 *
 * Montados com `APP_URL`, o endereço público: a API não tem nome público e não
 * saberia dizer onde ela mesma está (regra 4).
 */
function issuer(): string {
  return (process.env.APP_URL ?? "").replace(/\/+$/, "");
}

/** RFC 9728: o recurso protegido, e quem emite token para ele. */
export function protectedResourceMetadata(): Record<string, unknown> {
  return {
    resource: `${issuer()}/mcp`,
    authorization_servers: [issuer()],
    scopes_supported: [OAUTH_SCOPE],
    bearer_methods_supported: ["header"],
    resource_name: "PostIt",
  };
}

/** RFC 8414: o servidor de autorização. A autorização é a tela de permissão. */
export function authorizationServerMetadata(): Record<string, unknown> {
  const base = issuer();
  return {
    issuer: base,
    authorization_endpoint: `${base}/oauth/autorizar`,
    token_endpoint: `${base}/oauth/token`,
    registration_endpoint: `${base}/oauth/register`,
    scopes_supported: [OAUTH_SCOPE],
    response_types_supported: ["code"],
    grant_types_supported: ["authorization_code", "refresh_token"],
    token_endpoint_auth_methods_supported: ["none"],
    code_challenge_methods_supported: ["S256"],
    // CIMD primeiro, registro dinâmico aceito (especificação do MCP de 2026-07-28).
    client_id_metadata_document_supported: true,
    // RFC 9207: o retorno leva `iss`, contra a confusão entre servidores.
    authorization_response_iss_parameter_supported: true,
  };
}
