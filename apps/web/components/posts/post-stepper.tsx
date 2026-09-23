import { Check } from "lucide-react";
import type { ReactNode } from "react";
import { PUBLISH_MAX_ATTEMPTS, postSteps, type PostDetail, type PostStepState } from "@repo/shared";
import { AccountDateTime } from "@/components/account-time";
import { PostStatusBadge } from "@/components/posts/post-status-badge";
import { cn } from "@/lib/utils";

/**
 * As duas etapas da postagem, no topo da página — como num checkout (ADR 0026).
 *
 * **1 · Composição** e **2 · Revisão** são as páginas em que alguém age. O que vem
 * depois — agendada, publicando, publicada, falhou — não é etapa: é estado, e
 * aparece à direita, na pílula e numa frase.
 *
 * Duas listas no HTML, uma por tamanho de tela, e só uma visível: no computador os
 * passos com subtítulo; no celular, "Etapa 2 de 2 · Revisão" com duas barras. As
 * duas trazem `aria-current="step"` na etapa atual, e a escondida sai da árvore de
 * acessibilidade junto com o `display: none`.
 */
const STEPS = [
  { name: "Composição", hint: "Formato, mídia e legenda" },
  { name: "Revisão", hint: "Aprovação e horário" },
] as const;

export function PostStepper({
  post,
  timeZone,
}: {
  /** `null` na postagem nova, que ainda não existe: é rascunho por definição. */
  readonly post: PostDetail | null;
  readonly timeZone: string;
}): ReactNode {
  const status = post?.status ?? "DRAFT";
  const etapas = postSteps(status);
  const atual = etapas.indexOf("current");
  const sentence = post === null ? "Em montagem. Ninguém revisou ainda." : stateSentence(post, timeZone);

  return (
    <div className="flex flex-col gap-3 rounded-2xl border bg-card p-4 md:flex-row md:items-center md:gap-5 md:px-5">
      <ol aria-label="Etapas da postagem" className="hidden min-w-0 flex-1 items-center gap-3.5 md:flex">
        {STEPS.map((step, indice) => (
          <li
            key={step.name}
            aria-current={etapas[indice] === "current" ? "step" : undefined}
            className={cn("flex min-w-0 items-center gap-2.5", indice === 1 && "flex-1")}
          >
            {indice === 1 && (
              <span
                aria-hidden
                className={cn(
                  "h-0.5 max-w-35 min-w-8 flex-1 rounded-full",
                  etapas[0] === "done" ? "bg-primary" : "bg-border",
                )}
              />
            )}
            <StepDot state={etapas[indice]!} number={indice + 1} />
            <span className={cn("min-w-0", etapas[indice] === "off" && "opacity-50")}>
              <span
                className={cn(
                  "block text-sm font-bold",
                  etapas[indice] === "pending" && "font-semibold text-muted-foreground",
                )}
              >
                {step.name}
              </span>
              <span className="block text-xs text-muted-foreground">{step.hint}</span>
            </span>
          </li>
        ))}
      </ol>

      {/* No celular: compacto, uma linha e duas barras. */}
      <div className="flex flex-col gap-2 md:hidden">
        <p className="text-[13px]">
          {status === "CANCELED" ? (
            <strong className="font-heading text-[15px]">Fora das etapas</strong>
          ) : atual === -1 ? (
            <strong className="font-heading text-[15px]">Etapas concluídas</strong>
          ) : (
            <>
              Etapa {atual + 1} de 2 · <strong className="font-heading text-[15px]">{STEPS[atual]!.name}</strong>
            </>
          )}
        </p>
        <ol aria-label="Etapas da postagem" className="grid grid-cols-2 gap-1.5">
          {STEPS.map((step, indice) => (
            <li key={step.name} aria-current={etapas[indice] === "current" ? "step" : undefined}>
              <span className="sr-only">
                {step.name}
                {etapas[indice] === "done" ? " (concluída)" : ""}
              </span>
              <span aria-hidden className={cn("block h-1.5 rounded-full", BAR[etapas[indice]!])} />
            </li>
          ))}
        </ol>
      </div>

      <div className="flex flex-wrap items-center gap-2.5 md:max-w-95 md:border-l md:pl-5">
        <PostStatusBadge status={status} />
        <span className="text-[13px] text-muted-foreground">{sentence}</span>
      </div>
    </div>
  );
}

const BAR: Record<PostStepState, string> = {
  done: "bg-primary",
  current: "bg-highlight",
  pending: "bg-border",
  off: "bg-border opacity-50",
};

/** A etapa concluída ganha o ✓ em azul; a atual, a lima; a pendente, só a borda. */
function StepDot({ state, number }: { readonly state: PostStepState; readonly number: number }): ReactNode {
  return (
    <span
      aria-hidden
      className={cn(
        "flex size-7.5 shrink-0 items-center justify-center rounded-full border-[1.5px] text-[13px] font-bold tabular-nums",
        state === "done" && "border-primary bg-primary text-primary-foreground",
        state === "current" && "border-highlight bg-highlight text-highlight-foreground",
        (state === "pending" || state === "off") && "border-border bg-card text-muted-foreground",
        state === "off" && "opacity-50",
      )}
    >
      {state === "done" ? <Check className="size-4" strokeWidth={3} /> : number}
    </span>
  );
}

/** Onde a postagem está, numa frase — o estado que não é etapa. */
function stateSentence(post: PostDetail, timeZone: string): ReactNode {
  switch (post.status) {
    case "DRAFT":
      return post.lastDecision?.action === "REJECTED"
        ? "Voltou da revisão com um pedido de ajuste."
        : "Em montagem. Ninguém revisou ainda.";
    case "IN_REVIEW":
      return "Esperando aprovação.";
    case "APPROVED":
      return "Aprovada. Falta escolher o horário.";
    case "SCHEDULED":
      return (
        <>
          Sai em <AccountDateTime iso={post.scheduledAt} timeZone={timeZone} />.
        </>
      );
    case "PROCESSING":
      return post.attempts >= 1 && post.failureCause !== null
        ? `Saindo agora — tentativa ${post.attempts} de ${PUBLISH_MAX_ATTEMPTS}.`
        : "Saindo agora.";
    case "PUBLISHED":
      return post.publication === null ? (
        "Publicada."
      ) : (
        <>
          No ar desde <AccountDateTime iso={post.publication.publishedAt} timeZone={timeZone} />.
        </>
      );
    case "FAILED":
      return "Não saiu. Precisa de uma decisão.";
    case "CANCELED":
      return "Fora do fluxo. Não vai ao ar.";
  }
}
