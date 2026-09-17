"use client";

import type { ReactNode } from "react";

/**
 * Uma data no fuso de **quem está lendo**.
 *
 * É componente de cliente de propósito. Formatar no servidor usaria o fuso do
 * servidor (AGENTS.md, regra 7): a mesma tela diria horários diferentes conforme
 * onde o PostIt estivesse hospedado, e ninguém perceberia até a diferença ser de
 * um dia inteiro.
 *
 * O horário da conta do Instagram é outra coisa e não passa por aqui: aquele usa
 * o identificador IANA da conta, não o do aparelho.
 */
export function LocalDate({
  iso,
  format = "curta",
  fallback = "—",
}: {
  readonly iso: string | null;
  /** `longa` = "12 de junho de 2026"; `curta` = "12/06/2026"; `comHora` acrescenta o horário. */
  readonly format?: "longa" | "curta" | "comHora";
  readonly fallback?: string;
}): ReactNode {
  if (iso === null) return fallback;

  const data = new Date(iso);
  if (Number.isNaN(data.getTime())) return fallback;

  return <time dateTime={iso}>{formatar(data, format)}</time>;
}

/** "setembro de 2026" — para "No PostIt desde". */
export function LocalMonth({ iso, fallback = "—" }: { readonly iso: string | null; readonly fallback?: string }) {
  if (iso === null) return fallback;

  const data = new Date(iso);
  if (Number.isNaN(data.getTime())) return fallback;

  return <time dateTime={iso}>{data.toLocaleDateString("pt-BR", { month: "long", year: "numeric" })}</time>;
}

function formatar(data: Date, format: "longa" | "curta" | "comHora"): string {
  if (format === "longa") return data.toLocaleDateString("pt-BR", { day: "numeric", month: "long", year: "numeric" });
  if (format === "comHora") return data.toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" });
  return data.toLocaleDateString("pt-BR", { dateStyle: "short" });
}
