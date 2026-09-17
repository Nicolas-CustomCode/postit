import type { ReactNode } from "react";
import { AppShell } from "@/components/nav/app-shell";
import { listAccounts } from "@/lib/data/accounts";
import { requireSession } from "@/lib/auth/session";

/**
 * A casca de quem entrou.
 *
 * ⚠️ O `requireSession()` daqui é conveniência, **não** é a proteção: layout não
 * re-renderiza na troca de rota, então quem for desativado no meio da navegação
 * continuaria passando por ele. Cada página e cada Server Action chama o seu.
 *
 * Pelo mesmo motivo, **a conta ativa não é calculada aqui**. Ela sai do endereço
 * (AGENTS.md, regra 24), e quem a lê são os componentes de cliente da casca, com
 * `useActiveAccount()` — o único jeito de ela acompanhar a navegação.
 */
export default async function AutenticadoLayout({ children }: { readonly children: ReactNode }): Promise<ReactNode> {
  const [{ user }, accounts] = await Promise.all([requireSession(), listAccounts()]);

  return (
    <AppShell user={user} accounts={accounts}>
      {children}
    </AppShell>
  );
}
