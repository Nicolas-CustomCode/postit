import type { Metadata } from "next";
import type { ReactNode } from "react";
import { PageHeader } from "@/components/nav/page-header";
import { NotificationList } from "@/components/notifications/notification-list";
import { Card } from "@/components/ui/card";
import { requireSession } from "@/lib/auth/session";
import { listNotifications } from "@/lib/data/notifications";

export const metadata: Metadata = { title: "Notificações" };

/**
 * O sino (RF-J01; docs/13, "Notificações").
 *
 * Tela **geral**: lista os avisos de todas as contas, cada um com a conta
 * indicada, e tocar abre a postagem já na conta dela. Não pede permissão — cada
 * pessoa vê só os próprios avisos, e quem decide isso é a API.
 */
export default async function NotificacoesPage(): Promise<ReactNode> {
  await requireSession();
  const items = await listNotifications();

  return (
    <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-6 px-4 pb-8 md:px-10 md:py-7">
      <PageHeader
        trail={["Geral", "Notificações"]}
        title="Notificações"
        description="Publicações que falharam, contas sem acesso e postagens que esperam uma decisão."
      />

      <Card className="gap-0 overflow-hidden rounded-2xl py-0">
        <NotificationList items={items} />
      </Card>
    </main>
  );
}
