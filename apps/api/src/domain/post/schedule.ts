import type { PostStatus } from "@repo/shared";
import { possibleInstants } from "../time/zone";
import { canTransition } from "./post-state";

/**
 * As regras de agendar (RF-D01, RF-D03, RF-D04; ADR 0006).
 *
 * A aritmética de fuso mora em [time/zone.ts](../time/zone.ts); aqui fica a
 * **política**: o que fazer com cada desfecho, e quem pode marcar horário a
 * partir de qual estado.
 */

export type ScheduleProblem = "SCHEDULE_TIME_DOES_NOT_EXIST" | "SCHEDULE_IN_PAST";

export type ScheduleResult = { readonly instant: Date } | { readonly problem: ScheduleProblem };

/**
 * O instante em que aquela postagem deve sair, ou por que não dá.
 *
 * ⚠️ **O passado é medido em minutos, não em segundos.** O campo da tela entrega
 * minuto, então agendar "para agora" chega aqui como o minuto corrente — e
 * recusar por ter levado sete segundos entre digitar e clicar seria hostil sem
 * proteger nada. A regra é: o minuto escolhido não pode ser **anterior ao minuto
 * corrente**. Nada quebra por aceitar um instante alguns segundos vencido: a
 * invariante I-8 tolera até 15 minutos de atraso.
 */
export function resolveSchedule(input: {
  day: string;
  time: string;
  timeZone: string;
  now: Date;
}): ScheduleResult {
  const { instants } = possibleInstants(input.day, input.time, input.timeZone);

  // Nenhum instante: o relógio pulou essa hora naquele dia (ADR 0006).
  const instant = instants[0];
  if (instant === undefined) return { problem: "SCHEDULE_TIME_DOES_NOT_EXIST" };

  if (instant.getTime() < startOfMinute(input.now)) return { problem: "SCHEDULE_IN_PAST" };

  return { instant };
}

/** O começo do minuto corrente — a granularidade que o campo da tela tem. */
function startOfMinute(now: Date): number {
  return Math.floor(now.getTime() / 60_000) * 60_000;
}

/**
 * O que "marcar horário" significa a partir deste estado.
 *
 * ⚠️ **Nenhuma aresta nova.** `AGENDADO` continua `AGENDADO` quando se
 * reagenda — o status não muda, então **não é transição**, e por isso este caso
 * não passa por `canTransition()`. É o mesmo raciocínio que a máquina já aplica
 * ao laço `PROCESSANDO → PROCESSANDO`, e o que o AGENTS.md quer dizer com
 * "reagendar é um `UPDATE`" (regra 8).
 *
 * A aresta que existe, `APROVADO → AGENDADO`, continua sendo a única fonte de
 * verdade sobre quem chega lá (invariante I-1) — e `FALHOU → AGENDADO` entra de
 * graça por ela, que é o "humano reagenda" da I-4.
 */
export type ScheduleMove = "TRANSITION" | "REPLACE_TIME";

export function scheduleMoveFor(status: PostStatus): ScheduleMove | null {
  // Reagendar: o campo muda, o estado não.
  if (status === "SCHEDULED") return "REPLACE_TIME";
  return canTransition(status, "SCHEDULED") ? "TRANSITION" : null;
}

/** Cancelar vale só no que já tem horário marcado ou parou de vez (RF-D05). */
export function canCancel(status: PostStatus): boolean {
  // Literal, e não `canTransition(status, "CANCELED")`: aquilo aceitaria
  // `RASCUNHO` e viraria um segundo caminho para descartar — com outra
  // permissão. Descartar rascunho é `POSTAGEM_EDITAR`; cancelar agendada é
  // `POSTAGEM_AGENDAR`. A mesma aresta tem duas portas de propósito.
  return status === "SCHEDULED" || status === "FAILED";
}
