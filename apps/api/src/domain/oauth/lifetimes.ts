/**
 * Os prazos do acesso do assistente (ADR 0029, decisão 4).
 *
 * A autorização segue os prazos da sessão — 30 dias de teto, 7 sem uso —, e por isso
 * a validade dela sai do mesmo `sessionState` (domain/auth/session-validity.ts). O
 * token de acesso é curto de propósito: vazou, vale por uma hora no máximo.
 */

const MINUTE_MS = 60 * 1000;

/** O código de autorização só atravessa o redirecionamento; um minuto sobra. */
export const CODE_TTL_MS = MINUTE_MS;

export const ACCESS_TOKEN_TTL_MS = 60 * MINUTE_MS;

/** O acesso nunca passa do teto da autorização, nem se emitido no último minuto dela. */
export function accessTokenExpiry(now: Date, grantExpiresAt: Date): Date {
  return new Date(Math.min(now.getTime() + ACCESS_TOKEN_TTL_MS, grantExpiresAt.getTime()));
}

export type RefreshTokenState = "USABLE" | "EXPIRED" | "REVOKED" | "REUSED";

export interface RefreshTokenTimes {
  readonly expiresAt: Date;
  readonly usedAt: Date | null;
  readonly revokedAt: Date | null;
}

/**
 * A renovação roda: cada uso devolve uma nova e marca a velha como usada.
 *
 * A velha aparecer de novo significa que existem duas cópias dela — a do cliente e a
 * de mais alguém —, e não há como saber qual é a legítima. Quem chama derruba a
 * autorização inteira (OAuth 2.1, seção 4.3.1). Por isso usada vem antes de vencida:
 * uma cópia vazada e antiga continua sendo o sinal.
 */
export function refreshTokenState(token: RefreshTokenTimes, now: Date): RefreshTokenState {
  if (token.usedAt !== null) return "REUSED";
  if (token.revokedAt !== null) return "REVOKED";
  if (token.expiresAt.getTime() <= now.getTime()) return "EXPIRED";
  return "USABLE";
}
