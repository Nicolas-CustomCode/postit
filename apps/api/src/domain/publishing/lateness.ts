/**
 * Até quando uma postagem ainda pode sair (invariante I-8; ADR 0007).
 *
 * Duas regras, com dois limites, porque respondem a perguntas diferentes:
 *
 * - **Começar** — 15 minutos. Uma postagem que nem começou até 15 minutos depois do
 *   horário não começa mais: o sistema estava fora do ar, e publicar às 13h o que
 *   era das 10h é o que o ADR 0007 proíbe.
 * - **Terminar** — 45 minutos. A que começou no horário e caiu em retentativa pode
 *   levar mais; a espera real do pg-boss (1–2, 2–4, 4–8 e 8–15 min entre as
 *   tentativas, mais até 5 min de preparo em cada) passaria de 45. Passado disso,
 *   nenhuma tentativa cria container nem publica. Decidido em 22/09/2026.
 */

export const LATE_START_TOLERANCE_MS = 15 * 60_000;
export const LATE_CEILING_MS = 45 * 60_000;

/**
 * Quanto o despachante olha adiante. Ele roda a cada minuto; sem a folga, uma
 * postagem das 10:00:30 só seria pega na volta das 10:01. Com ela, é pega às
 * 10:00, e a tarefa espera o instante exato com `startAfter` (docs/09).
 */
export const DISPATCH_LOOKAHEAD_MS = 60_000;

/** O limite da varredura do despachante: tudo que vence até aqui. */
export function dispatchHorizon(now: Date): Date {
  return new Date(now.getTime() + DISPATCH_LOOKAHEAD_MS);
}

/** Passou dos 15 minutos sem começar? Exatamente 15 ainda vale. */
export function isTooLateToStart(scheduledAt: Date, now: Date): boolean {
  return now.getTime() - scheduledAt.getTime() > LATE_START_TOLERANCE_MS;
}

/** Passou dos 45 minutos? A partir daí, nenhuma chamada nova à Meta. */
export function isPastCeiling(scheduledAt: Date, now: Date): boolean {
  return now.getTime() - scheduledAt.getTime() > LATE_CEILING_MS;
}
