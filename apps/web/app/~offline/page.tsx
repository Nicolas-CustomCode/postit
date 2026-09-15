import { WifiOff } from "lucide-react";
import type { Metadata } from "next";
import { connection } from "next/server";
import type { ReactNode } from "react";

export const metadata: Metadata = { title: "Sem conexão" };

/**
 * O que aparece quando falta sinal (RF-J05). Vai no precache do service worker,
 * em app/serwist/[path]/route.ts: página de "sem conexão" que depende da rede
 * não serve para nada.
 *
 * Montada a cada acesso, como as demais: gerada no build ela sairia sem nonce, e
 * a CSP bloquearia os scripts dela.
 */
export default async function OfflinePage(): Promise<ReactNode> {
  await connection();

  return (
    <main className="mx-auto flex w-full max-w-md flex-1 flex-col items-center justify-center gap-3 px-4 py-16 text-center">
      <WifiOff className="size-[22px] text-muted-foreground" strokeWidth={2} aria-hidden />
      <h1 className="text-xl font-bold">Sem conexão</h1>
      <p className="text-muted-foreground">
        O PostIt precisa de internet para mostrar postagens e contas. Assim que o sinal voltar, é só tentar de novo.
      </p>
    </main>
  );
}
