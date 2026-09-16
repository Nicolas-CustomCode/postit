/**
 * Quando uma sessão vale (ADR 0013, seção 3).
 *
 * São dois prazos que convivem, e é de propósito:
 *  - inatividade: 7 dias sem uso e a sessão morre, mesmo que o teto esteja longe;
 *  - teto absoluto: 30 dias desde a criação, **nunca estendido**. Sem ele, um
 *    computador esquecido logado fica logado para sempre — a falha registrada no
 *    nossobuncker.
 *
 * Funções puras, com a data vindo de fora: é o que permite testar as bordas
 * exatas sem esperar sete dias nem mexer no relógio do processo.
 */

export type SessionState = "ACTIVE" | "REVOKED" | "MAX_EXPIRED" | "IDLE_EXPIRED";

export interface SessionTimes {
  readonly expiresAt: Date;
  readonly lastUsedAt: Date;
  readonly revokedAt: Date | null;
}

const DAY_MS = 24 * 60 * 60 * 1000;

/** O teto, fixado na criação. Quem chamar de novo depois está fazendo errado. */
export function sessionExpiry(createdAt: Date, maxDays: number): Date {
  return new Date(createdAt.getTime() + maxDays * DAY_MS);
}

export function sessionState(session: SessionTimes, now: Date, idleDays: number): SessionState {
  if (session.revokedAt !== null) return "REVOKED";
  if (session.expiresAt.getTime() <= now.getTime()) return "MAX_EXPIRED";
  if (now.getTime() - session.lastUsedAt.getTime() >= idleDays * DAY_MS) return "IDLE_EXPIRED";
  return "ACTIVE";
}

/**
 * `ultimoUsoEm` é reescrito no máximo uma vez por hora.
 *
 * Sem esse freio, toda requisição autenticada vira um UPDATE na tabela mais
 * quente do sistema. Uma hora é bem menor que os 7 dias de inatividade, então a
 * precisão perdida não muda nenhuma decisão.
 */
export const TOUCH_INTERVAL_MS = 60 * 60 * 1000;

export function shouldTouch(lastUsedAt: Date, now: Date): boolean {
  return now.getTime() - lastUsedAt.getTime() >= TOUCH_INTERVAL_MS;
}
