import type { PublishFailureCause } from "@repo/shared";

/**
 * O que fazer com cada erro de publicação (docs/08, "Tabela de códigos de erro";
 * docs/09, "Classificação de erros").
 *
 * A regra que orienta a tabela: **não gastar tentativa em erro que não vai mudar
 * sozinho, e não desistir de erro que vai.**
 *
 * - `RECOVERABLE` — o publicador lança, e o pg-boss agenda nova tentativa
 * - `FATAL` — o publicador marca `FALHOU` e termina sem lançar
 * - `AMBIGUOUS` — só no `media_publish`: sem resposta, não se sabe se a Meta
 *   publicou, e quem decide é a reconciliação (docs/09, "O caso difícil")
 */

/** As etapas que falam com a Meta. */
export type PublishStepName = "CREATE_CONTAINER" | "CHECK_STATUS" | "PUBLISH";

export type FailureOutcome =
  | { readonly kind: "RECOVERABLE"; readonly cause: PublishFailureCause; readonly discardContainer: boolean }
  | { readonly kind: "FATAL"; readonly cause: PublishFailureCause; readonly flagsAccount: boolean }
  | { readonly kind: "AMBIGUOUS" };

/** O essencial de uma recusa da Meta — o mesmo que `MetaError`, sem depender do cliente. */
export interface Refusal {
  readonly status: number;
  readonly code: number | null;
  readonly subcode: number | null;
}

const recoverable = (cause: PublishFailureCause, discardContainer = false): FailureOutcome => ({
  kind: "RECOVERABLE",
  cause,
  discardContainer,
});
const fatal = (cause: PublishFailureCause, flagsAccount = false): FailureOutcome => ({
  kind: "FATAL",
  cause,
  flagsAccount,
});

const RATE_LIMIT_CODES = new Set([4, 17, 32, 613]);

/** Uma recusa com código, ou uma resposta fora do formato documentado. */
export function classifyRefusal(refusal: Refusal, step: PublishStepName): FailureOutcome {
  const { status, code, subcode } = refusal;

  /*
   * No `media_publish`, instabilidade não é recusa: um 5xx, ou um 200 com corpo
   * estranho, pode ter vindo **depois** de a Meta publicar. Tratar como
   * recuperável repetiria a publicação às cegas.
   */
  if (step === "PUBLISH" && (status >= 500 || code === null)) return { kind: "AMBIGUOUS" };
  if (status >= 500 || code === null) return recoverable("META_UNSTABLE");

  // A conta — nenhuma tentativa muda isso; a conta ganha o sinal de reconectar.
  if (code === 190 || code === 102) return fatal("TOKEN_INVALID", true);
  if (code === 10 || code === 200) return fatal("PERMISSION_MISSING", true);
  if (code === 25 || subcode === 2207050) return fatal("ACCOUNT_RESTRICTED");
  if (code === 9 && subcode === 2207042) return fatal("QUOTA_EXCEEDED");

  if (RATE_LIMIT_CODES.has(code)) return recoverable("RATE_LIMITED");

  switch (subcode) {
    case 2207003: // demorou demais para baixar
    case 2207053: // erro desconhecido no envio
      return recoverable("META_UNSTABLE");
    case 2207032: // falhou ao criar — o container não serve mais
      return recoverable("CONTAINER_CREATE_FAILED", true);
    case 2207027: // publicar antes de FINISHED
      return recoverable("CONTAINER_NOT_READY");
    case 2207020:
      return fatal("CONTAINER_EXPIRED");
    case 2207052:
      return fatal("MEDIA_DOWNLOAD_FAILED");
    case 2207028:
      return fatal("CAROUSEL_COUNT");
    // Não deveriam chegar aqui: o envio (RF-B02) e a composição barram antes. Se
    // chegarem, o validador tem uma lacuna (docs/08).
    case 2207004:
    case 2207005:
    case 2207009:
      return fatal("MEDIA_REJECTED");
  }

  /*
   * Código que a tabela não conhece: fatal. Um 4xx desconhecido é, quase sempre,
   * pedido que a Meta não aceita — repetir o mesmo pedido cinco vezes só gasta
   * cota. O corpo cru fica na auditoria para quem for investigar.
   */
  return fatal("META_REFUSED");
}

/** Sem resposta: rede caiu ou o tempo esgotou. */
export function classifyUnavailable(step: PublishStepName): FailureOutcome {
  return step === "PUBLISH" ? { kind: "AMBIGUOUS" } : recoverable("NETWORK");
}
