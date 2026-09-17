import { headers } from "next/headers";
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
 * A conta ativa sai do endereço (AGENTS.md, regra 24). Lemos o caminho do
 * cabeçalho que o proxy.ts repassa, porque layout não recebe os parâmetros da
 * rota filha.
 */
export default async function AutenticadoLayout({ children }: { readonly children: ReactNode }): Promise<ReactNode> {
  const [{ user }, accounts, cabecalhos] = await Promise.all([requireSession(), listAccounts(), headers()]);

  const caminho = cabecalhos.get("x-pathname") ?? "";
  const partes = caminho.split("/").filter((parte) => parte.length > 0);
  const activeUsername = partes[0] === "c" ? decodeURIComponent(partes[1] ?? "") || null : null;
  // A seção é o que vem depois da conta; serve para trocar de conta sem sair da
  // tela em que a pessoa está.
  const currentSection = partes[0] === "c" ? (partes[2] ?? "calendario") : "calendario";

  return (
    <AppShell user={user} accounts={accounts} activeUsername={activeUsername} currentSection={currentSection}>
      {children}
    </AppShell>
  );
}
