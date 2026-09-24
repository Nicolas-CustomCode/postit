import type { ReactNode } from "react";
import { AppShell } from "@/components/nav/app-shell";
import { accountToOpen } from "@/lib/accounts/active-account";
import { listAccounts } from "@/lib/data/accounts";
import { unreadNotificationCount } from "@/lib/data/notifications";
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
 *
 * O `lembrada` é outra coisa, e não contraria o acima: é **para onde voltar
 * quando o endereço não tem conta nenhuma** — em Contas, Perfil ou Acervo. Não
 * depende da rota, só do cookie, então pode sair daqui. Sem ele, quem estivesse
 * numa tela geral no celular não tinha como voltar às telas da conta.
 */
export default async function AutenticadoLayout({ children }: { readonly children: ReactNode }): Promise<ReactNode> {
  const [{ user }, accounts, naoLidas] = await Promise.all([
    requireSession(),
    listAccounts(),
    unreadNotificationCount(),
  ]);
  const lembrada = await accountToOpen(accounts);

  // O número do sino também não depende da rota; ele só envelhece, e a casca o
  // consulta de novo a cada minuto (`UnreadCountProvider`).
  return (
    <AppShell
      user={user}
      accounts={accounts}
      rememberedAccount={lembrada?.username ?? null}
      unreadCount={naoLidas}
    >
      {children}
    </AppShell>
  );
}
