import type { PostFormat } from "@repo/shared";

/**
 * Quando ler as métricas de uma publicação (docs/09, "Coleta de métricas").
 *
 * | Momento | Formato |
 * |---|---|
 * | T+1h | todos |
 * | T+20h | só Stories — as métricas somem em 24h, e as 4 horas de folga cobrem a Meta instável |
 * | T+24h | todos menos Stories |
 * | T+7d | todos menos Stories |
 */
export type MetricMoment = "T1H" | "STORY_20H" | "T24H" | "T7D";

const HOUR_MS = 60 * 60_000;

export function metricMomentsFor(
  format: PostFormat,
  publishedAt: Date,
): { readonly moment: MetricMoment; readonly startAfter: Date }[] {
  const after = (hours: number) => new Date(publishedAt.getTime() + hours * HOUR_MS);

  if (format === "STORIES") {
    return [
      { moment: "T1H", startAfter: after(1) },
      { moment: "STORY_20H", startAfter: after(20) },
    ];
  }
  return [
    { moment: "T1H", startAfter: after(1) },
    { moment: "T24H", startAfter: after(24) },
    { moment: "T7D", startAfter: after(24 * 7) },
  ];
}
