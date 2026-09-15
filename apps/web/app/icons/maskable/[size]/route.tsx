import { ImageResponse } from "next/og";

import { BrandMark, ICON_SIZES, parseIconSize } from "@/lib/brand-mark";

export const dynamicParams = false;

export function generateStaticParams(): { size: string }[] {
  return ICON_SIZES.map((size) => ({ size: String(size) }));
}

/**
 * Ícones `maskable` do Android: fundo azul sem cantos, que o sistema recorta no
 * formato dele. O P já cabe na zona segura, os 80% centrais (docs/13).
 *
 * Segmento fixo ganha de dinâmico no Next: /icons/maskable/192 cai aqui, e não
 * em app/icons/[size].
 */
export async function GET(_request: Request, { params }: { params: Promise<{ size: string }> }): Promise<Response> {
  const size = parseIconSize((await params).size);
  return new ImageResponse(<BrandMark size={size} rounded={false} dot />, { width: size, height: size });
}
