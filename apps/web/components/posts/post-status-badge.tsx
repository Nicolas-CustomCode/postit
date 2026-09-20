import type { ReactNode } from "react";
import { POST_STATUS_LABELS, type PostStatus } from "@repo/shared";

/**
 * O estado da postagem, em pílula (docs/13, "Cores dos status"; artboard
 * `ComposicaoDesktop`).
 *
 * **Cor nunca é o único sinal.** A pílula traz o nome escrito **e** um ponto da
 * cor do texto — quem não distingue as cores precisa da mesma informação. É a
 * razão de o calendário da Fase 3 herdar esta peça em vez de pintar
 * quadradinhos.
 *
 * As cores vêm das variáveis do tema, nunca de uma paleta escolhida aqui: o
 * AGENTS.md não admite cor fora do docs/13, e é lá que o par texto/fundo de cada
 * status está fixado — eles andam juntos para o contraste não depender de sorte.
 *
 * Medidas do artboard: 28 px de altura, cantos totalmente arredondados, 13 px em
 * peso 600, ponto de 7 px.
 */
const TONE: Record<PostStatus, { text: string; background: string }> = {
  DRAFT: { text: "var(--status-rascunho)", background: "var(--status-rascunho-bg)" },
  IN_REVIEW: { text: "var(--status-revisao)", background: "var(--status-revisao-bg)" },
  APPROVED: { text: "var(--status-aprovado)", background: "var(--status-aprovado-bg)" },
  SCHEDULED: { text: "var(--status-agendado)", background: "var(--status-agendado-bg)" },
  PROCESSING: { text: "var(--status-processando)", background: "var(--status-processando-bg)" },
  PUBLISHED: { text: "var(--status-publicado)", background: "var(--status-publicado-bg)" },
  FAILED: { text: "var(--status-falhou)", background: "var(--status-falhou-bg)" },
  // Cancelado é o único sem fundo: só borda e texto riscado (docs/13).
  CANCELED: { text: "var(--status-cancelado)", background: "transparent" },
};

export function PostStatusBadge({ status }: { readonly status: PostStatus }): ReactNode {
  const tom = TONE[status];
  const cancelado = status === "CANCELED";

  return (
    <span
      className="inline-flex h-7 shrink-0 items-center gap-1.5 rounded-full px-3 text-[13px] font-semibold"
      style={{
        color: tom.text,
        background: tom.background,
        ...(cancelado ? { border: `1px solid ${tom.text}`, textDecoration: "line-through" } : {}),
      }}
    >
      <span className="size-[7px] rounded-full" style={{ background: tom.text }} aria-hidden />
      {POST_STATUS_LABELS[status]}
    </span>
  );
}
