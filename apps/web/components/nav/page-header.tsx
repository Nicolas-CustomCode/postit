import { ChevronLeft } from "lucide-react";
import Link from "next/link";
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
  besideTitle,
  back,
}: {
  /** O caminho até aqui, do mais geral ao mais específico. */
  readonly trail: readonly string[];
  readonly title: string;
  readonly description?: string;
  readonly actions?: ReactNode;
  /**
   * O que fica **colado no título**, e não à direita: a pílula de status e o
   * "Salvo às 14:32" da composição. O artboard os põe aí de propósito — eles
   * dizem respeito ao que se está olhando, enquanto `actions` são o que se pode
   * fazer com aquilo.
   */
  readonly besideTitle?: ReactNode;
  /**
   * O "‹ Postagens" do celular, só onde a barra inferior some (ADR 0026): sem ele,
   * a página da postagem não tinha saída nenhuma. No computador a barra lateral
   * continua à vista, e o link sobraria.
   */
  readonly back?: { readonly href: string; readonly label: string };
}): ReactNode {
  return (
    <div className="flex flex-col gap-2">
      {back === undefined ? null : (
        <Link
          href={back.href}
          className="-ml-1 flex h-11 items-center gap-1 self-start pr-2 text-sm font-medium text-muted-foreground md:hidden"
        >
          <ChevronLeft className="size-5" aria-hidden />
          {back.label}
        </Link>
      )}
      {trail.length === 0 ? null : <p className="text-[13px] text-muted-foreground">{trail.join(" / ")}</p>}

      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex flex-wrap items-center gap-3.5">
          <h1 className="font-heading text-[30px] font-extrabold tracking-[-0.02em] md:text-[34px]">{title}</h1>
          {besideTitle}
        </div>
        {actions}
      </div>

      {description === undefined ? null : <p className="text-muted-foreground">{description}</p>}
    </div>
  );
}
