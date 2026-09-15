import type { MetadataRoute } from "next";

import { BRAND_VERSION, ICON_SIZES } from "@/lib/brand-mark";

/**
 * O manifesto do app instalável (docs/adr/0017). Cores em hex: quem lê é o
 * sistema operacional. São cópias do --background claro de app/globals.css.
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "PostIt",
    short_name: "PostIt",
    description: "Agendador interno de postagens",
    lang: "pt-BR",
    // O endereço gravado no aparelho na instalação. `/` decide para onde ir.
    start_url: "/",
    scope: "/",
    display: "standalone",
    background_color: "#F6F7FB",
    theme_color: "#F6F7FB",
    // 192 e 512 são exigência do Chrome para oferecer a instalação.
    icons: ICON_SIZES.flatMap((size) => [
      { src: `/icons/${size}?v=${BRAND_VERSION}`, sizes: `${size}x${size}`, type: "image/png", purpose: "any" as const },
      {
        src: `/icons/maskable/${size}?v=${BRAND_VERSION}`,
        sizes: `${size}x${size}`,
        type: "image/png",
        purpose: "maskable" as const,
      },
    ]),
  };
}
