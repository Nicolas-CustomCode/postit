import { possibleInstants } from "../time/zone";

/**
 * O dia civil de uma conta, e os limites dele em tempo absoluto.
 *
 * Regra pura: sem Nest, sem Prisma, sem rede. A conversão entre relógio e
 * instante mora em [time/zone.ts](../time/zone.ts), que é onde os casos de
 * transição de horário de verão estão resolvidos e testados — aqui fica só o
 * conceito de dia.
 *
 * **Por que tudo é `string` e não `Date`:** o dia de uma métrica é um *rótulo
 * civil* ("15 de setembro"), não um instante. A coluna é `@db.Date`, e o Prisma
 * serializa um `Date` JS pela parte de data **em UTC** — então
 * `new Date(2026, 8, 15)` num processo em `America/Sao_Paulo` grava o dia 14.
 * O `TZ=UTC` do compose é do container do Postgres, não do Node. Mantendo o
 * rótulo como texto, a única conversão do projeto é `dayToDatabase()`, aqui
 * embaixo, e ela é explícita.
 *
 * As janelas saem em segundos porque é o que a Meta quer em `since`/`until`
 * (docs/08, "Insights da conta").
 */

/** Um dia civil, como `2026-09-15`. */
export type DayLabel = string;

export interface DayWindow {
  /** Começo do dia, em segundos Unix. */
  readonly since: number;
  /** Começo do dia seguinte, em segundos Unix. */
  readonly until: number;
}

const DAY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

/**
 * O dia civil daquele instante, no fuso daquela conta.
 *
 * `en-CA` de propósito: é o locale cujo formato numérico curto já é
 * `AAAA-MM-DD`, então não há remontagem manual de pedaços para errar.
 */
export function dayLabel(instant: Date, timeZone: string): DayLabel {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(instant);
}

/**
 * Começo e fim de um dia civil, em tempo absoluto.
 *
 * ⚠️ **O fim não é o começo mais 24 horas.** No dia em que um fuso entra no
 * horário de verão, o dia civil tem 23 horas; no dia em que sai, 25. Por isso os
 * dois limites saem de conversões independentes — somar 86400 daria o instante
 * errado duas vezes por ano, e em silêncio (ADR 0006).
 */
export function dayWindow(day: DayLabel, timeZone: string): DayWindow {
  assertDayLabel(day);

  return {
    since: Math.floor(startOfDay(day, timeZone).getTime() / 1000),
    until: Math.floor(startOfDay(nextDay(day), timeZone).getTime() / 1000),
  };
}

/**
 * O instante em que aquele dia civil começa naquele fuso.
 *
 * ⚠️ **Meia-noite nem sempre existe.** Santiago muda o relógio à meia-noite — e
 * o Brasil fazia o mesmo até 2019 —, então há dias que começam às 01:00. A
 * versão anterior desta função chutava e corrigia duas vezes, e nesses dias
 * devolvia **23:00 do dia anterior**: a janela inteira saía uma hora deslocada,
 * e o teste de "dias seguidos se encostam" passava porque os dois lados erravam
 * juntos.
 *
 * `possibleInstants` sabe dizer que o relógio não existe, e `afterGap` é
 * exatamente o instante em que aquele dia começa a valer.
 */
function startOfDay(day: DayLabel, timeZone: string): Date {
  const { instants, afterGap } = possibleInstants(day, "00:00", timeZone);
  return instants[0] ?? afterGap;
}

/** O dia civil seguinte. Aritmética em UTC: rótulo não tem fuso. */
export function nextDay(day: DayLabel): DayLabel {
  assertDayLabel(day);
  return new Date(Date.parse(`${day}T00:00:00.000Z`) + 86_400_000).toISOString().slice(0, 10);
}

/** O dia civil `count` dias antes. */
export function daysBefore(day: DayLabel, count: number): DayLabel {
  assertDayLabel(day);
  return new Date(Date.parse(`${day}T00:00:00.000Z`) - count * 86_400_000).toISOString().slice(0, 10);
}

/**
 * Os dias de `from` até `to`, inclusive nos dois extremos.
 *
 * Devolve vazio quando `from` é depois de `to`, em vez de laçar para sempre — é
 * o que acontece numa conta criada hoje quando se pede o retroativo.
 */
export function daysBetween(from: DayLabel, to: DayLabel): DayLabel[] {
  assertDayLabel(from);
  assertDayLabel(to);

  const dias: DayLabel[] = [];
  for (let dia = from; dia <= to; dia = nextDay(dia)) dias.push(dia);
  return dias;
}

/**
 * O rótulo virando o valor que o Prisma grava numa coluna `@db.Date`.
 *
 * **É a única conversão de dia para `Date` do projeto.** Sempre meia-noite UTC,
 * nunca o construtor com números soltos — ver o cabeçalho deste arquivo.
 */
export function dayToDatabase(day: DayLabel): Date {
  assertDayLabel(day);
  return new Date(`${day}T00:00:00.000Z`);
}

/** O caminho inverso, para ler o que o Prisma devolveu. */
export function dayFromDatabase(value: Date): DayLabel {
  return value.toISOString().slice(0, 10);
}

function assertDayLabel(day: string): void {
  if (!DAY_PATTERN.test(day)) throw new Error(`Dia civil em formato inesperado: "${day}"`);
}
