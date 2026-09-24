import type { ReactNode } from "react";
import type { AccountSummary, SessionUser } from "@repo/shared";
import { BottomBar } from "@/components/nav/bottom-bar";
import { MobileTopBar } from "@/components/nav/mobile-top-bar";
import { PushResync } from "@/components/nav/push-resync";
import { Sidebar } from "@/components/nav/sidebar";
import { UnreadCountProvider } from "@/components/nav/unread-count";

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
 *
 * O `rememberedAccount` **não é a conta ativa** e não contraria o de cima: é a
 * semente para as telas gerais, onde o endereço não tem conta nenhuma. Pela
 * mesma razão do parágrafo anterior ele não pode ser usado sozinho — quem o
 * recebe passa pelo `useShellAccount()`, que dá precedência ao endereço atual.
 */
export function AppShell({
  user,
  accounts,
  rememberedAccount,
  unreadCount,
  children,
}: {
  readonly user: SessionUser;
  readonly accounts: readonly AccountSummary[];
  /** Que conta a casca mostra quando o endereço não tem nenhuma. */
  readonly rememberedAccount: string | null;
  /** A semente do número do sino; quem o mantém em dia é o `UnreadCountProvider`. */
  readonly unreadCount: number;
  readonly children: ReactNode;
}): ReactNode {
  return (
    // min-h-dvh, e não min-h-screen: no celular a barra do navegador aparece e
    // some, e `vh` não acompanha — o rodapé fica cortado.
    <UnreadCountProvider initial={unreadCount}>
      <PushResync />
      <div className="flex min-h-dvh">
        <Sidebar user={user} accounts={accounts} rememberedAccount={rememberedAccount} />

        <div className="flex min-w-0 flex-1 flex-col">
          <MobileTopBar accounts={accounts} />

          <div className="flex min-w-0 flex-1 flex-col">{children}</div>

          <BottomBar user={user} rememberedAccount={rememberedAccount} />
        </div>
      </div>
    </UnreadCountProvider>
  );
}
