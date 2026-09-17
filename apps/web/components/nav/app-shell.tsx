import type { ReactNode } from "react";
import type { AccountSummary, SessionUser } from "@repo/shared";
import { AccountSwitcher } from "@/components/nav/account-switcher";
import { BottomBar } from "@/components/nav/bottom-bar";
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
 */
export function AppShell({
  user,
  accounts,
  activeUsername,
  currentSection,
  children,
}: {
  readonly user: SessionUser;
  readonly accounts: readonly AccountSummary[];
  readonly activeUsername: string | null;
  readonly currentSection: string;
  readonly children: ReactNode;
}): ReactNode {
  return (
    // min-h-dvh, e não min-h-screen: no celular a barra do navegador aparece e
    // some, e `vh` não acompanha — o rodapé fica cortado.
    <div className="flex min-h-dvh">
      <Sidebar user={user} accounts={accounts} activeUsername={activeUsername} currentSection={currentSection} />

      <div className="flex min-w-0 flex-1 flex-col">
        {/*
         * A pílula só existe nas telas da conta (docs/13, "Navegação"). Em
         * Perfil ou Contas ela dizia "Nenhuma conta", que não quer dizer nada:
         * são telas gerais, que não dependem de conta nenhuma.
         */}
        {activeUsername === null ? null : (
          <header className="flex min-w-0 items-center px-4 pt-5 pb-3 md:hidden">
            <AccountSwitcher
              accounts={accounts}
              activeUsername={activeUsername}
              currentSection={currentSection}
              variant="mobile"
            />
          </header>
        )}

        <div className="flex min-w-0 flex-1 flex-col">{children}</div>

        <BottomBar user={user} activeUsername={activeUsername} />
      </div>
    </div>
  );
}
