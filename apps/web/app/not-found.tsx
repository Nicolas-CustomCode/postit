import type { Metadata } from "next";
import Link from "next/link";
import { connection } from "next/server";
import type { ReactNode } from "react";

export const metadata: Metadata = { title: "Página não encontrada" };

/**
 * A página 404. Existe para ser montada a cada acesso: a padrão do Next é gerada
 * no build, sai sem nonce, e a CSP bloquearia os scripts dela.
 */
export default async function NotFound(): Promise<ReactNode> {
  await connection();

  return (
    <main className="mx-auto flex w-full max-w-md flex-1 flex-col items-center justify-center gap-3 px-4 py-16 text-center">
      <h1 className="text-xl font-bold">Página não encontrada</h1>
      <p className="text-muted-foreground">O endereço pode ter mudado ou a página não existe mais.</p>
      <Link href="/" className="font-semibold text-primary underline-offset-4 hover:underline">
        Voltar ao início
      </Link>
    </main>
  );
}
