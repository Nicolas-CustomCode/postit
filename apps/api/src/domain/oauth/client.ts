/**
 * Quem pode se apresentar como cliente OAuth (ADR 0029).
 *
 * Duas portas, com as mesmas exigências:
 *  - CIMD: o `client_id` é uma URL https, e a ficha do cliente está nela. A especificação
 *    de autorização do MCP de 2026-07-28 prefere esta;
 *  - registro dinâmico (RFC 7591): o cliente manda a ficha e recebe um `client_id`
 *    sorteado aqui. A mesma especificação o marca como obsoleto, mas o ChatGPT ainda o usa.
 *
 * Nos dois, só cliente público — sem segredo, com PKCE — e endereços de retorno fixos.
 */

export interface ClientMetadata {
  readonly name: string;
  readonly redirectUris: string[];
}

export type ClientProblem = { readonly problem: string };

const MAX_REDIRECT_URIS = 10;
const MAX_NAME_LENGTH = 100;

/**
 * Endereço de retorno aceito: https, ou http de loopback para aplicativo de linha de
 * comando (RFC 8252, seção 7.3). Sem fragmento, que o RFC 6749 proíbe no retorno.
 */
export function isAcceptableRedirectUri(value: string): boolean {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return false;
  }
  if (url.hash !== "" || value.includes("#")) return false;
  if (url.username !== "" || url.password !== "") return false;
  if (url.protocol === "https:") return true;
  return url.protocol === "http:" && (url.hostname === "localhost" || url.hostname === "127.0.0.1");
}

/**
 * A URL que serve de `client_id` no CIMD: https, com caminho, sem fragmento nem
 * credenciais (draft-ietf-oauth-client-id-metadata-document, seção 3).
 */
export function isClientMetadataUrl(value: string): boolean {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return false;
  }
  return (
    url.protocol === "https:" &&
    url.pathname !== "/" &&
    url.hash === "" &&
    !value.includes("#") &&
    url.username === "" &&
    url.password === ""
  );
}

/** Ficha lida do CIMD. O `client_id` dela tem de ser a própria URL de onde veio. */
export function parseClientMetadataDocument(clientId: string, document: unknown): ClientMetadata | ClientProblem {
  if (typeof document !== "object" || document === null) return { problem: "a ficha não é um objeto JSON" };
  const doc = document as Record<string, unknown>;
  if (doc["client_id"] !== clientId) return { problem: "o client_id da ficha difere da URL" };
  return parseMetadata(doc, new URL(clientId).hostname);
}

/** Ficha do registro dinâmico (RFC 7591, seção 2). */
export function parseRegistrationRequest(body: unknown): ClientMetadata | ClientProblem {
  if (typeof body !== "object" || body === null) return { problem: "o pedido não é um objeto JSON" };
  return parseMetadata(body as Record<string, unknown>, "Aplicativo sem nome");
}

function parseMetadata(doc: Record<string, unknown>, fallbackName: string): ClientMetadata | ClientProblem {
  const uris = doc["redirect_uris"];
  if (!Array.isArray(uris) || uris.length === 0 || uris.length > MAX_REDIRECT_URIS) {
    return { problem: "redirect_uris precisa ter de 1 a 10 endereços" };
  }
  if (!uris.every((uri) => typeof uri === "string" && isAcceptableRedirectUri(uri))) {
    return { problem: "redirect_uris só aceita https, ou http de localhost" };
  }

  // Ausente, o RFC 7591 presume client_secret_basic — mas sem segredo nenhum a
  // presunção não se aplica. O cliente precisa conseguir trocar o código sem
  // autenticar: `none` declarado, ou na lista dos que ele aceita. A ficha do
  // ChatGPT (29/09/2026) prefere private_key_jwt e lista none; como o PostIt anuncia
  // só none, é com ele que o ChatGPT troca.
  const authMethod = doc["token_endpoint_auth_method"];
  const supported = doc["token_endpoint_auth_methods_supported"];
  const acceptsNone = Array.isArray(supported) && supported.includes("none");
  if (authMethod !== undefined && authMethod !== "none" && !acceptsNone) {
    return { problem: "só cliente público: o cliente precisa aceitar token_endpoint_auth_method none" };
  }

  const grantTypes = doc["grant_types"];
  if (grantTypes !== undefined) {
    if (!Array.isArray(grantTypes) || !grantTypes.includes("authorization_code")) {
      return { problem: "grant_types precisa incluir authorization_code" };
    }
  }

  const rawName = doc["client_name"];
  const name = typeof rawName === "string" && rawName.trim() !== "" ? rawName.trim() : fallbackName;
  return { name: name.slice(0, MAX_NAME_LENGTH), redirectUris: uris as string[] };
}

export function isClientProblem(value: ClientMetadata | ClientProblem): value is ClientProblem {
  return "problem" in value;
}
