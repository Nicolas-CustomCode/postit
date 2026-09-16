import type { ReactNode } from "react";
import { brandSvg } from "@/lib/brand-mark";

/**
 * O ícone do PostIt dentro da página.
 *
 * Reaproveita o mesmo desenho dos ícones do app instalável (docs/13), de modo
 * que a marca não possa divergir entre a aba, a tela inicial do celular e a
 * página. O SVG é gerado pelo nosso código, não vem de conteúdo de usuário.
 */
export function BrandSvg({ className }: { readonly className?: string }): ReactNode {
  return (
    <span
      className={className}
      aria-hidden
      // Conteúdo nosso, construído por brandSvg(): não há dado de usuário aqui.
      dangerouslySetInnerHTML={{ __html: brandSvg({ rounded: true, dot: true }) }}
    />
  );
}
