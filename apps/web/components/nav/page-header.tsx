import type { ReactNode } from "react";

/**
 * O topo de uma tela de dentro do sistema: migalha e título (artboard
 * `ComposicaoDesktop`).
 *
 * A migalha começa pela conta quando a tela é de uma conta. Não é enfeite: com a
 * barra lateral fora do campo de visão de quem rola a página, é ela que mantém
 * visível **em que conta** a pessoa está agindo (docs/13, "Conta ativa").
 *
 * Ela aparece também no celular, onde o artefato não a desenha: lá o topo mostra
 * o **nome** da conta, e dois clientes com nome parecido não se distinguem por
 * ele. O `@` é o endereço da conta, e é ele que precisa estar à vista.
 */
export function PageHeader({
  trail,
  title,
  description,
  actions,
}: {
  /** O caminho até aqui, do mais geral ao mais específico. */
  readonly trail: readonly string[];
  readonly title: string;
  readonly description?: string;
  readonly actions?: ReactNode;
}): ReactNode {
  return (
    <div className="flex flex-col gap-2">
      {trail.length === 0 ? null : <p className="text-[13px] text-muted-foreground">{trail.join(" / ")}</p>}

      <div className="flex flex-wrap items-center justify-between gap-4">
        <h1 className="font-heading text-[30px] font-extrabold tracking-[-0.02em] md:text-[34px]">{title}</h1>
        {actions}
      </div>

      {description === undefined ? null : <p className="text-muted-foreground">{description}</p>}
    </div>
  );
}
