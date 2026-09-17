import type { ReactNode } from "react";
import type { AccountSummary, SessionUser } from "@repo/shared";
import { BottomBar } from "@/components/nav/bottom-bar";
import { MobileTopBar } from "@/components/nav/mobile-top-bar";
import { Sidebar } from "@/components/nav/sidebar";

/**
 * A casca do sistema: barra lateral no computador, barra inferior no celular.
 *
 * O seletor de conta aparece duas vezes de propósito — no topo da lateral, no
 * computador, e como a pílula no topo da tela, no celular (docs/13,
 * "Navegação"). São os dois lugares onde a pessoa olha para saber em que conta
 * está agindo, e a conta errada é o erro mais caro que ela pode cometer aqui.
 *
 * Não há cabeçalho no computador: quem está usando aparece no rodapé da barra
 * lateral, e o caminho da tela vem da migalha de cada página.
 *
 * ⚠️ **A conta ativa não passa por aqui.** Cada peça a lê do endereço, pelo
 * `useActiveAccount()`. Derivá-la neste layout foi um erro: no App Router o
 * layout não roda de novo ao navegar entre rotas que o compartilham, e a barra
 * lateral ficava congelada em "Nenhuma conta" depois de entrar por uma tela
 * geral.
 */
export function AppShell({
  user,
  accounts,
  children,
}: {
  readonly user: SessionUser;
  readonly accounts: readonly AccountSummary[];
  readonly children: ReactNode;
}): ReactNode {
  return (
    // min-h-dvh, e não min-h-screen: no celular a barra do navegador aparece e
    // some, e `vh` não acompanha — o rodapé fica cortado.
    <div className="flex min-h-dvh">
      <Sidebar user={user} accounts={accounts} />

      <div className="flex min-w-0 flex-1 flex-col">
        <MobileTopBar accounts={accounts} />

        <div className="flex min-w-0 flex-1 flex-col">{children}</div>

        <BottomBar user={user} />
      </div>
    </div>
  );
}
