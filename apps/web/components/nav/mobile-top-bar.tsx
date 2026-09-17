"use client";

import type { ReactNode } from "react";
import type { AccountSummary } from "@repo/shared";
import { AccountSwitcher } from "@/components/nav/account-switcher";
import { useActiveAccount } from "@/lib/nav/use-active-account";

/**
 * O topo do celular: a pílula da conta ativa (artboard `CalendarioCelular`).
 *
 * Só aparece nas **telas da conta** (docs/13, "Navegação"). Em Perfil ou Contas
 * não há conta ativa, e a pílula dizia "Nenhuma conta" — que não quer dizer nada
 * numa tela que não depende de conta.
 *
 * É componente de cliente porque a decisão depende do endereço atual, e o layout
 * do servidor não roda de novo na navegação pelo cliente.
 */
export function MobileTopBar({ accounts }: { readonly accounts: readonly AccountSummary[] }): ReactNode {
  const { username } = useActiveAccount();
  if (username === null) return null;

  return (
    <header className="flex min-w-0 items-center px-4 pt-5 pb-3 md:hidden">
      <AccountSwitcher accounts={accounts} variant="mobile" />
    </header>
  );
}
