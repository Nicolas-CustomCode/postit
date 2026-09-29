import { OAUTH_SCOPE } from "@repo/shared";
import { isValidCodeChallenge } from "./pkce";

/**
 * O pedido de autorização que abre a tela de permissão (RFC 6749, seção 4.1.1, com o
 * PKCE e o indicador de recurso do OAuth 2.1 e do RFC 8707).
 *
 * Há dois tipos de erro, e a diferença é de segurança:
 *  - FATAL: cliente desconhecido ou endereço de retorno que não é dele. Não se
 *    redireciona para lá — seria um redirecionamento aberto a serviço de quem forjou o
 *    link. A tela mostra o erro e para;
 *  - REDIRECT: o endereço é confiável, então o erro volta ao cliente por ele.
 */

export interface AuthorizeParams {
  readonly responseType?: string;
  readonly redirectUri?: string;
  readonly codeChallenge?: string;
  readonly codeChallengeMethod?: string;
  readonly scope?: string;
  readonly resource?: string;
}

export type AuthorizeDecision =
  | { readonly kind: "OK"; readonly redirectUri: string; readonly codeChallenge: string; readonly resource: string }
  | { readonly kind: "FATAL"; readonly reason: string }
  | { readonly kind: "REDIRECT"; readonly redirectUri: string; readonly error: string; readonly description: string };

/**
 * Confere o pedido contra o cliente já identificado. `expectedResource` é o endereço
 * do `/mcp` público: o token sai valendo só para ele.
 */
export function decideAuthorize(
  params: AuthorizeParams,
  clientRedirectUris: readonly string[],
  expectedResource: string,
): AuthorizeDecision {
  // Sem redirect_uri, só dá para seguir se o cliente tem um endereço só (RFC 6749, 3.1.2.3).
  const redirectUri = params.redirectUri ?? (clientRedirectUris.length === 1 ? clientRedirectUris[0] : undefined);
  if (redirectUri === undefined) return { kind: "FATAL", reason: "redirect_uri ausente" };
  // Comparação exata, caractere por caractere (OAuth 2.1, seção 2.3.1).
  if (!clientRedirectUris.includes(redirectUri)) {
    return { kind: "FATAL", reason: "redirect_uri não registrado para este cliente" };
  }

  const refuse = (error: string, description: string): AuthorizeDecision => ({
    kind: "REDIRECT",
    redirectUri,
    error,
    description,
  });

  if (params.responseType !== "code") {
    return refuse("unsupported_response_type", "só response_type=code");
  }
  if (params.codeChallenge === undefined || !isValidCodeChallenge(params.codeChallenge)) {
    return refuse("invalid_request", "code_challenge obrigatório (PKCE)");
  }
  if (params.codeChallengeMethod !== "S256") {
    return refuse("invalid_request", "só code_challenge_method=S256");
  }
  if (!isScopeAcceptable(params.scope)) {
    return refuse("invalid_scope", `o único escopo é ${OAUTH_SCOPE}`);
  }
  if (params.resource !== undefined && !sameResource(params.resource, expectedResource)) {
    return refuse("invalid_target", "este servidor só autoriza o próprio /mcp");
  }

  return { kind: "OK", redirectUri, codeChallenge: params.codeChallenge, resource: expectedResource };
}

/** Ausente vale o escopo único; presente, só pode pedir ele. */
export function isScopeAcceptable(scope: string | undefined): boolean {
  if (scope === undefined || scope.trim() === "") return true;
  return scope
    .split(" ")
    .filter((s) => s !== "")
    .every((s) => s === OAUTH_SCOPE);
}

/** A barra final não muda o recurso: `https://app/mcp` e `https://app/mcp/` são o mesmo. */
export function sameResource(received: string, expected: string): boolean {
  const trim = (value: string) => value.replace(/\/+$/, "");
  return trim(received) === trim(expected);
}
