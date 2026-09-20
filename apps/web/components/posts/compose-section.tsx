import type { ReactNode } from "react";

/**
 * Um bloco da composição (artboard `ComposicaoDesktop`).
 *
 * Cada assunto — formato, mídia, legenda, horário — é um cartão com título
 * próprio, em vez de um formulário corrido. É o que permite a tela crescer com
 * marcações, colaboradores e capa (Fase 2) sem virar uma coluna infinita, e o
 * que o celular transforma em etapas.
 *
 * As medidas saem do artboard: 20 px de folga, cantos de 16 px, título em
 * Bricolage 18 px peso 700.
 */
export function ComposeSection({
  title,
  aside,
  children,
}: {
  readonly title: string;
  /** O que fica à direita do título — "3 de até 10", um contador, um aviso. */
  readonly aside?: ReactNode;
  readonly children: ReactNode;
}): ReactNode {
  return (
    <section className="flex flex-col gap-3 rounded-2xl border bg-card p-5">
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <h2 className="font-heading text-lg font-bold">{title}</h2>
        {aside}
      </div>
      {children}
    </section>
  );
}
