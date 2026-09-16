import type { ReactNode } from "react";
import { BrandSvg } from "@/components/brand";
import { logoutAction } from "@/lib/actions/auth";
import { requireSession } from "@/lib/auth/session";

/**
 * A casca das telas de quem entrou.
 *
 * ⚠️ O `requireSession()` daqui é conveniência, **não** é a proteção: layout não
 * re-renderiza na troca de rota (o Next só re-renderiza a parte que muda), então
 * quem for desativado no meio da navegação continuaria passando por este `if`.
 * Cada página e cada Server Action chama `requireSession()` por conta própria.
 *
 * A navegação de verdade — barra lateral, seletor de conta — chega no Bloco C.
 */
export default async function AutenticadoLayout({ children }: { readonly children: ReactNode }): Promise<ReactNode> {
  const { user } = await requireSession();

  return (
    <div className="flex min-h-full flex-col">
      <header className="flex items-center justify-between gap-3 border-b px-4 py-3">
        <div className="flex items-center gap-2">
          <BrandSvg className="size-7" />
          <span className="font-heading text-lg font-extrabold tracking-tight">PostIt</span>
        </div>

        <div className="flex items-center gap-3">
          <span className="hidden text-sm text-muted-foreground sm:inline">{user.email}</span>
          <form action={logoutAction}>
            <button type="submit" className="text-sm font-semibold underline-offset-4 hover:underline">
              Sair
            </button>
          </form>
        </div>
      </header>

      {children}
    </div>
  );
}
