import { LogOut } from "lucide-react";
import type { Metadata } from "next";
import type { ReactNode } from "react";
import { VERSION } from "@repo/shared";
import { LocalMonth } from "@/components/local-date";
import { PageHeader } from "@/components/nav/page-header";
import { Button } from "@/components/ui/button";
import { logoutAction } from "@/lib/actions/auth";
import { getSecurityOverview } from "@/lib/data/security";
import { listActiveSessions } from "@/lib/data/sessions";
import { requireSession } from "@/lib/auth/session";
import { DevicesCard } from "./devices-card";
import { IdentityCard, PermissionsCard } from "./identity-card";
import { SecurityCard } from "./security-card";

export const metadata: Metadata = { title: "Perfil" };

/**
 * O perfil (RF-H07): quem você é, o que pode fazer, e o estado da sua segurança.
 *
 * Duas colunas no computador (artboard `PerfilDesktop`): identidade e permissões
 * à esquerda, ações à direita. Uma coluna no celular, na mesma ordem.
 *
 * Preferências de notificação e "ativar push" entram na Fase 1, junto com o
 * push. A proteção é o `requireSession()` daqui — não a do layout.
 */
export default async function PerfilPage(): Promise<ReactNode> {
  const { user } = await requireSession();
  const [sessions, security] = await Promise.all([listActiveSessions(), getSecurityOverview()]);

  return (
    <main className="mx-auto flex w-full max-w-5xl flex-1 flex-col gap-6 px-4 pb-8 md:px-10 md:py-7">
      <PageHeader
        trail={["Geral", "Perfil"]}
        title={user.name}
        actions={
          <form action={logoutAction}>
            <Button type="submit" variant="secondary" className="h-11 md:h-10">
              <LogOut className="size-4.5" strokeWidth={2} aria-hidden />
              Sair do PostIt
            </Button>
          </form>
        }
      />

      <div className="grid gap-5 lg:grid-cols-[360px_minmax(0,1fr)] lg:items-start lg:gap-7">
        <div className="flex flex-col gap-5">
          <IdentityCard user={user} memberSince={<LocalMonth iso={security.memberSince} />} />
          <PermissionsCard user={user} />
        </div>

        <div className="flex flex-col gap-5">
          <SecurityCard security={security} />
          <DevicesCard sessions={sessions} />
        </div>
      </div>

      <p className="text-center text-xs text-muted-foreground tabular-nums">PostIt v{VERSION}</p>
    </main>
  );
}
