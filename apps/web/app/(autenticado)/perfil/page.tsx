import type { Metadata } from "next";
import type { ReactNode } from "react";
import { VERSION } from "@repo/shared";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { listActiveSessions } from "@/lib/data/sessions";
import { requireSession } from "@/lib/auth/session";
import { ChangePasswordForm } from "./change-password-form";
import { RecoveryCodesForm } from "./recovery-codes-form";
import { SessionsList } from "./sessions-list";

export const metadata: Metadata = { title: "Perfil" };

/**
 * O perfil (RF-H07): trocar senha, gerar códigos de recuperação e ver onde a
 * conta está conectada.
 *
 * Preferências de notificação e "ativar push" entram na Fase 1, junto com o
 * push. A proteção é o `requireSession()` daqui — não a do layout.
 */
export default async function PerfilPage(): Promise<ReactNode> {
  const { user } = await requireSession();
  const sessions = await listActiveSessions();

  return (
    <main className="mx-auto flex w-full max-w-2xl flex-1 flex-col gap-6 px-4 py-8">
      <div>
        <h1 className="font-heading text-[28px] font-extrabold tracking-tight">{user.name}</h1>
        <p className="text-muted-foreground">
          {user.email}
          {user.superAdmin ? " · super admin" : null}
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="font-heading text-lg">Trocar a senha</CardTitle>
          <CardDescription>Pede a senha atual e um código do aplicativo. Os outros aparelhos saem.</CardDescription>
        </CardHeader>
        <CardContent>
          <ChangePasswordForm />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="font-heading text-lg">Códigos de recuperação</CardTitle>
          <CardDescription>Servem para entrar se você perder o celular. Gerar novos invalida os antigos.</CardDescription>
        </CardHeader>
        <CardContent>
          <RecoveryCodesForm />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="font-heading text-lg">Aparelhos conectados</CardTitle>
          <CardDescription>Não reconhece algum? Encerre os outros e troque a senha.</CardDescription>
        </CardHeader>
        <CardContent>
          <SessionsList sessions={sessions} />
        </CardContent>
      </Card>

      <p className="text-center text-xs text-muted-foreground tabular-nums">PostIt v{VERSION}</p>
    </main>
  );
}
