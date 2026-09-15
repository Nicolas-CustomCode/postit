import { createHash } from "node:crypto";
import type { ReactElement } from "react";

/**
 * O ícone do PostIt — opção A, "Ponto" (docs/13, "Ícone do app").
 *
 * O desenho é o SVG aprovado, com cores em hexadecimal: o ImageResponse, que
 * transforma isto em PNG, roda fora do navegador, sem Tailwind e sem as
 * variáveis de cor do tema.
 */

const BLUE = "#3544E6";
const LIME = "#C6F432";

export interface BrandSvgOptions {
  /** Cantos arredondados. Sem eles no maskable e no iOS, que recortam por conta própria. */
  readonly rounded: boolean;
  /** O ponto lima. Some no favicon de 16 e 32 px, onde vira borrão. */
  readonly dot: boolean;
}

export function brandSvg({ rounded, dot }: BrandSvgOptions): string {
  return [
    `<svg viewBox="0 0 512 512" xmlns="http://www.w3.org/2000/svg">`,
    `<rect width="512" height="512"${rounded ? ` rx="116"` : ""} fill="${BLUE}"/>`,
    `<rect x="126" y="112" width="72" height="290" rx="22" fill="#FFFFFF"/>`,
    `<path d="M162 148 H268 A82 82 0 0 1 268 312 H162" fill="none" stroke="#FFFFFF" stroke-width="72" stroke-linejoin="round"/>`,
    dot ? `<circle cx="268" cy="230" r="24" fill="${LIME}"/>` : "",
    `</svg>`,
  ].join("");
}

/**
 * Impressão digital do desenho, para o `?v=` dos ícones do manifesto. O sistema
 * guarda o ícone na instalação; sem mudar o endereço, uma arte nova nunca
 * chegaria a quem já instalou.
 */
export const BRAND_VERSION = createHash("sha256")
  .update(brandSvg({ rounded: true, dot: true }))
  .digest("hex")
  .slice(0, 8);

/** Os tamanhos do manifesto: o Chrome só oferece a instalação com 192 e 512. */
export const ICON_SIZES = [192, 512] as const;

export function parseIconSize(raw: string): (typeof ICON_SIZES)[number] {
  const size = ICON_SIZES.find((entry) => String(entry) === raw);
  if (!size) throw new Error(`Tamanho de ícone fora do manifesto: ${raw}`);
  return size;
}

/** O ícone como elemento para o ImageResponse. SVG entra por data URI, que é o que ele desenha bem. */
export function BrandMark({ size, ...options }: BrandSvgOptions & { readonly size: number }): ReactElement {
  const src = `data:image/svg+xml;base64,${Buffer.from(brandSvg(options)).toString("base64")}`;
  // eslint-disable-next-line @next/next/no-img-element -- renderizado pelo ImageResponse, não pelo navegador
  return <img src={src} width={size} height={size} alt="" />;
}
