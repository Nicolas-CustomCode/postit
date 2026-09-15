import { ImageResponse } from "next/og";

import { BrandMark, ICON_SIZES, parseIconSize } from "@/lib/brand-mark";

export const dynamicParams = false;

export function generateStaticParams(): { size: string }[] {
  return ICON_SIZES.map((size) => ({ size: String(size) }));
}

/** Ícones do manifesto, `purpose: "any"`: cantos arredondados, com o ponto lima. */
export async function GET(_request: Request, { params }: { params: Promise<{ size: string }> }): Promise<Response> {
  const size = parseIconSize((await params).size);
  return new ImageResponse(<BrandMark size={size} rounded dot />, { width: size, height: size });
}
