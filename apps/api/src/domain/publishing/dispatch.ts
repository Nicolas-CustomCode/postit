import { isTooLateToStart } from "./lateness";

/**
 * O que o despachante faz com cada postagem vencida (docs/09, "O despachante" e
 * "Guarda de cota").
 */

/**
 * A cota da Meta, com margem.
 *
 * 50 publicações em 24 horas corridas — a documentação diz 100 numa seção e 50 em
 * três, e o projeto adota 50 (docs/08, V-1). A margem de 10% existe porque a
 * contagem é nossa, e não da Meta (V-3): publicação feita fora do sistema, pelo
 * aplicativo, consome a mesma cota e não aparece aqui.
 */
export const PUBLISH_QUOTA = 50;
export const QUOTA_SAFETY_MARGIN = 0.1;
export const QUOTA_LIMIT = Math.floor(PUBLISH_QUOTA * (1 - QUOTA_SAFETY_MARGIN));

/**
 * Cabe mais uma publicação?
 *
 * `used` precisa somar **três** coisas: as publicadas nas últimas 24 horas, as que
 * estão em processamento e as já despachadas nesta mesma varredura. Sem as duas
 * últimas, dez postagens vencendo no mesmo minuto passariam todas pela conferência
 * com a mesma contagem, e a cota estouraria numa rajada de falhas — o que o RNF-04
 * proíbe.
 */
export function quotaAllows(used: number): boolean {
  return used < QUOTA_LIMIT;
}

export type DispatchDecision =
  | { readonly kind: "DISPATCH" }
  | { readonly kind: "DEFER" }
  | { readonly kind: "FAIL"; readonly cause: "SYSTEM_UNAVAILABLE" | "QUOTA_EXCEEDED" };

export function dispatchDecision(input: {
  scheduledAt: Date;
  now: Date;
  quotaAvailable: boolean;
  /** A postagem já estava esperando cota numa varredura anterior. */
  deferredForQuota: boolean;
}): DispatchDecision {
  /*
   * O atraso vem primeiro: passado o prazo de começar, não importa se há cota — a
   * postagem não sai mais sozinha. A causa diz a verdade sobre o motivo: quem
   * esperou cota até vencer não sofreu queda do sistema.
   */
  if (isTooLateToStart(input.scheduledAt, input.now)) {
    return { kind: "FAIL", cause: input.deferredForQuota ? "QUOTA_EXCEEDED" : "SYSTEM_UNAVAILABLE" };
  }
  if (!input.quotaAvailable) return { kind: "DEFER" };
  return { kind: "DISPATCH" };
}
