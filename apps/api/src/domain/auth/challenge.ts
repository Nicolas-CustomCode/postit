/**
 * O desafio entre a senha e o código (ADR 0013, seção 2).
 *
 * Senha certa sozinha NÃO cria sessão: cria isto, que vale poucos minutos e
 * poucas tentativas. É o que impede transformar "acertei a senha" em acesso.
 */

export type ChallengeState = "USABLE" | "EXPIRED" | "EXHAUSTED" | "COMPLETED";

export interface ChallengeTimes {
  readonly expiresAt: Date;
  readonly attempts: number;
  readonly completedAt: Date | null;
}

export function challengeExpiry(now: Date, ttlMinutes: number): Date {
  return new Date(now.getTime() + ttlMinutes * 60 * 1000);
}

export function challengeState(challenge: ChallengeTimes, now: Date, maxAttempts: number): ChallengeState {
  // Uso único: concluído não volta a valer, nem para repetir a mesma resposta.
  if (challenge.completedAt !== null) return "COMPLETED";
  if (challenge.expiresAt.getTime() <= now.getTime()) return "EXPIRED";
  if (challenge.attempts >= maxAttempts) return "EXHAUSTED";
  return "USABLE";
}
