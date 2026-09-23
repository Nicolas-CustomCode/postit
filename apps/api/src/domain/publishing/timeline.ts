import type { PostHistoryEntry, PostStatus, PublishFailureCause } from "@repo/shared";

/**
 * Os marcos da publicação que entram na linha do tempo da Revisão (ADR 0026).
 *
 * `EventoPublicacao` é o diário do motor — despachar, criar container, conferir,
 * publicar, cada tentativa. Na conversa da equipe isso é ruído: o que interessa é
 * "saiu", "não saiu" e "está tentando de novo". O diário inteiro continua no
 * histórico técnico da falha, recolhido.
 *
 * ⚠️ **A causa só vai no último "não saiu", e só com a postagem em `FALHOU`.**
 * `EventoPublicacao` não guarda causa por evento — só a postagem guarda a da última
 * falha (`ultimoErroCodigo`). Pôr essa causa numa falha antiga seria contar uma
 * história que o banco não sabe.
 */
export interface PublishMilestone {
  readonly at: string;
  readonly outcome: "PUBLISHED" | "FAILED" | "RETRYING";
  readonly cause: PublishFailureCause | null;
}

type EventInput = Pick<PostHistoryEntry, "at" | "step" | "result">;

export function publishMilestones(
  events: readonly EventInput[],
  post: { readonly status: PostStatus; readonly failureCause: PublishFailureCause | null },
): PublishMilestone[] {
  const marcos: PublishMilestone[] = [];

  for (const evento of events) {
    // Métricas não dizem nada sobre ter saído; despachar e adiar são espera, não tentativa.
    if (evento.step === "COLLECT_METRICS") continue;

    if (evento.result === "SUCCESS" && (evento.step === "PUBLISH" || evento.step === "RECONCILE")) {
      marcos.push({ at: evento.at, outcome: "PUBLISHED", cause: null });
    } else if (evento.result === "FATAL_ERROR" || evento.step === "GIVE_UP") {
      marcos.push({ at: evento.at, outcome: "FAILED", cause: null });
    } else if (evento.result === "RECOVERABLE_ERROR" && evento.step !== "DISPATCH") {
      // Cinco tentativas seguidas são um "tentando de novo", não cinco.
      if (marcos.at(-1)?.outcome !== "RETRYING") marcos.push({ at: evento.at, outcome: "RETRYING", cause: null });
    }
  }

  const ultimaFalha = marcos.findLastIndex((marco) => marco.outcome === "FAILED");
  if (post.status === "FAILED" && ultimaFalha >= 0) {
    marcos[ultimaFalha] = { ...marcos[ultimaFalha]!, cause: post.failureCause };
  }

  return marcos;
}
