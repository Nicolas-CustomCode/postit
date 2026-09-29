import { createHash } from "node:crypto";

/**
 * PKCE (RFC 7636), só o método S256 — o `plain` do RFC não protege nada e o OAuth 2.1
 * o deixa de fora.
 *
 * O cliente sorteia um segredo (verifier), manda o sha256 dele no pedido de autorização
 * (challenge) e só revela o segredo na troca do código. Quem interceptar o código no
 * caminho de volta não tem o segredo, e o código não serve para nada.
 */

/** 43 a 128 caracteres do alfabeto "unreserved" do RFC 7636, seção 4.1. */
const VERIFIER_PATTERN = /^[A-Za-z0-9\-._~]{43,128}$/;

/** sha256 em base64url sem preenchimento: sempre 43 caracteres. */
const CHALLENGE_PATTERN = /^[A-Za-z0-9\-_]{43}$/;

export function isValidCodeChallenge(challenge: string): boolean {
  return CHALLENGE_PATTERN.test(challenge);
}

export function pkceChallenge(verifier: string): string {
  return createHash("sha256").update(verifier).digest("base64url");
}

export function pkceMatches(verifier: string, challenge: string): boolean {
  if (!VERIFIER_PATTERN.test(verifier)) return false;
  return pkceChallenge(verifier) === challenge;
}
