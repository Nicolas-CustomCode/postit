import { VERSION } from "@repo/shared";
import { connection } from "next/server";
import type { ReactNode } from "react";

/**
 * Tela provisória da Fase 0, Bloco A: prova que o Next, o tema, as fontes e a CSP
 * estão de pé. No Bloco B, `/` passa a desviar para `/entrar` ou para a conta
 * ativa (docs/13).
 */
export default async function HomePage(): Promise<ReactNode> {
  // Página gerada no build não tem nonce; esta precisa ser montada a cada acesso.
  await connection();

  return (
    <main className="mx-auto flex w-full max-w-md flex-1 flex-col items-center justify-center gap-4 px-4 py-16 text-center">
      <h1 className="text-[34px] font-extrabold tracking-tight">PostIt</h1>
      <p className="text-muted-foreground">Fundação no ar. O login chega no próximo bloco.</p>
      <p className="rounded-full bg-highlight px-3 py-1 text-xs font-semibold text-highlight-foreground tabular-nums">
        v{VERSION}
      </p>
    </main>
  );
}
