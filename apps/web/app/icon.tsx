import { ImageResponse } from "next/og";

import { BrandMark } from "@/lib/brand-mark";

/**
 * O ícone da aba do navegador, em 16 e 32 px, **sem o ponto lima**, que some
 * nesse tamanho (docs/13). Não existe favicon.ico: com ele, o navegador o
 * preferiria a estes.
 */
export function generateImageMetadata(): { id: string; size: { width: number; height: number }; contentType: string }[] {
  return [16, 32].map((side) => ({ id: String(side), size: { width: side, height: side }, contentType: "image/png" }));
}

export default async function Icon({ id }: { readonly id: Promise<string> }): Promise<ImageResponse> {
  const side = Number(await id);
  return new ImageResponse(<BrandMark size={side} rounded dot={false} />, { width: side, height: side });
}
