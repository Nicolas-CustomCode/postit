import type { ReactNode } from "react";

/**
 * Horário no fuso **da conta** (ADR 0006; docs/09, "Fuso horário").
 *
 * ⚠️ **Não confunda com [local-date.tsx](./local-date.tsx)**, que formata no
 * fuso de **quem lê**. Os dois existem e servem a coisas diferentes: "Salvo às
 * 14:32" é um evento do sistema e aparece no relógio do aparelho; o horário em
 * que a postagem vai ao ar é da conta — quem edita do Brasil uma conta de
 * Lisboa precisa ver o horário de Lisboa.
 *
 * **Sem diretiva de propósito.** Não é `"use client"` porque `Intl` com
 * `timeZone` explícito não depende do ambiente, e não é `server-only` porque o
 * formulário de composição é componente de cliente e precisa importá-lo.
 *
 * As strings saem de `formatToParts`, e não de `toLocaleString`: a página é
 * renderizada no servidor e hidratada no navegador, com versões de CLDR que
 * podem separar diferente — e um aviso de hidratação apareceria justamente no
 * número que a pessoa foi conferir.
 */

function partsIn(instant: Date, timeZone: string): Record<string, string> {
  return Object.fromEntries(
    new Intl.DateTimeFormat("pt-BR", {
      timeZone,
      hour12: false,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    })
      .formatToParts(instant)
      .map((parte) => [parte.type, parte.value]),
  ) as Record<string, string>;
}

/** O instante como dia e hora no fuso da conta: "15/10/2026 às 10:00". */
export function AccountDateTime({
  iso,
  timeZone,
  fallback = "—",
}: {
  readonly iso: string | null;
  readonly timeZone: string;
  readonly fallback?: string;
}): ReactNode {
  if (iso === null) return fallback;

  const data = new Date(iso);
  if (Number.isNaN(data.getTime())) return fallback;

  const p = partsIn(data, timeZone);

  return (
    <time dateTime={iso} className="tabular-nums">
      {p["day"]}/{p["month"]}/{p["year"]} às {p["hour"]}:{p["minute"]}
    </time>
  );
}

/**
 * O nome do fuso da conta, em português.
 *
 * ⚠️ **Nunca escreva "Horário de Brasília" no JSX.** Hoje só existe conta em São
 * Paulo, e a frase fixa passaria no teste para virar mentira na segunda conta.
 * O `Intl` sabe: `America/Manaus` é "Horário Padrão do Amazonas",
 * `Europe/Lisbon` é "Horário da Europa Ocidental".
 *
 * `longGeneric` e não `long` porque é o nome **neutro de estação** — com `long`,
 * o rótulo oscilaria entre "Padrão" e "de Verão" conforme a data escolhida, num
 * texto que descreve a conta, não o instante.
 */
export function accountZoneName(timeZone: string): string {
  const nome = new Intl.DateTimeFormat("pt-BR", { timeZone, timeZoneName: "longGeneric" })
    .formatToParts(new Date())
    .find((parte) => parte.type === "timeZoneName")?.value;

  return nome ?? timeZone;
}

/**
 * O dia e a hora daquele instante no fuso da conta, para preencher os campos.
 *
 * Formatação pura: o caminho de volta — relógio para instante — é da API, que é
 * quem tem o fuso e a responsabilidade de decidir (regra 17).
 */
export function civilFieldsFor(iso: string | null, timeZone: string): { day: string; time: string } {
  if (iso === null) return { day: "", time: "" };

  const data = new Date(iso);
  if (Number.isNaN(data.getTime())) return { day: "", time: "" };

  const p = partsIn(data, timeZone);
  return {
    day: `${p["year"]}-${p["month"]}-${p["day"]}`,
    time: `${p["hour"]}:${p["minute"]}`,
  };
}

/** O dia de hoje no fuso da conta — o `min` do campo de data. */
export function todayIn(timeZone: string): string {
  return civilFieldsFor(new Date().toISOString(), timeZone).day;
}
