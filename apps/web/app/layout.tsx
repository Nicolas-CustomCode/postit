import { SerwistProvider } from "@serwist/turbopack/react";
import type { Metadata, Viewport } from "next";
import { Bricolage_Grotesque, Figtree } from "next/font/google";
import type { ReactNode } from "react";

import "./globals.css";

// As fontes são baixadas na construção e servidas pelo próprio app: a CSP só
// aceita fonte do próprio site (docs/13, "Tipografia").
const bricolage = Bricolage_Grotesque({ subsets: ["latin"], weight: ["600", "700", "800"], variable: "--font-bricolage" });
const figtree = Figtree({ subsets: ["latin"], weight: ["400", "500", "600", "700"], variable: "--font-figtree" });

export const metadata: Metadata = {
  title: { default: "PostIt", template: "%s · PostIt" },
  description: "Agendador interno de postagens",
  // Instalado no iPhone, o conteúdo vai até a barra de status.
  appleWebApp: { capable: true, title: "PostIt", statusBarStyle: "black-translucent" },
};

export const viewport: Viewport = {
  // A barra do sistema acompanha o --background de cada tema. Hex, porque quem
  // lê é o sistema operacional, não o CSS.
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#F6F7FB" },
    { media: "(prefers-color-scheme: dark)", color: "#0C0E16" },
  ],
  viewportFit: "cover",
};

export default function RootLayout({ children }: Readonly<{ children: ReactNode }>): ReactNode {
  return (
    <html lang="pt-BR" className={`${bricolage.variable} ${figtree.variable} h-full antialiased`}>
      <body className="flex min-h-full flex-col">
        {/* Registra o service worker compilado de app/sw.ts, servido por app/serwist/[path]. */}
        <SerwistProvider swUrl="/serwist/sw.js">{children}</SerwistProvider>
      </body>
    </html>
  );
}
