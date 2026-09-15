import { ImageResponse } from "next/og";

import { BrandMark } from "@/lib/brand-mark";

export const size = { width: 180, height: 180 };
export const contentType = "image/png";

/**
 * O ícone da tela inicial do iPhone, que ignora o manifesto. Sem cantos: o iOS
 * arredonda por cima, e um canto nosso viraria uma moldura.
 */
export default function AppleIcon(): ImageResponse {
  return new ImageResponse(<BrandMark size={size.width} rounded={false} dot />, size);
}
