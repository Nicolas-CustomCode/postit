"use client";

import { useState, useTransition, type ReactNode } from "react";
import type { NotificationItem } from "@repo/shared";
import { LocalDate } from "@/components/local-date";
import { useRefreshUnreadCount } from "@/components/nav/unread-count";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { markAllNotificationsReadAction, openNotificationAction } from "@/lib/actions/notifications";
import { describeNotification } from "@/lib/notifications/describe";
import { cn } from "@/lib/utils";

/**
 * A lista do sino (RF-J01; docs/04, 11.3): a frase montada com os dados de agora,
 * quando chegou, e tocar leva à tela certa e marca como lido.
 *
 * Cada linha é **botão**, e não link: abrir marca como lido, e isso é escrita —
 * Server Action (regra 13). Um link seria pré-carregado pelo Next e marcaria
 * avisos que ninguém abriu.
 *
 * A não lida tem o ponto lima **e** o peso: cor sozinha não é sinal (docs/13).
 */
export function NotificationList({ items }: { readonly items: readonly NotificationItem[] }): ReactNode {
  const [pendente, iniciar] = useTransition();
  const [erro, setErro] = useState<string | null>(null);
  const atualizarSino = useRefreshUnreadCount();
  const naoLidas = items.filter((item) => item.readAt === null).length;

  function abrir(id: string): void {
    setErro(null);
    iniciar(async () => {
      // Deu certo, a ação redireciona e nada volta; só o erro chega aqui.
      const resultado = await openNotificationAction(id);
      if (!resultado.ok) setErro(resultado.message);
    });
  }

  function marcarTodas(): void {
    setErro(null);
    iniciar(async () => {
      const resultado = await markAllNotificationsReadAction();
      if (!resultado.ok) setErro(resultado.message);
      // Marcar todos não troca de tela: sem isto, o selo esperaria a próxima consulta.
      await atualizarSino();
    });
  }

  if (items.length === 0) {
    return (
      <p className="px-5 py-10 text-center text-sm text-muted-foreground">
        Nenhuma notificação por aqui. Falhas de publicação, contas sem acesso e postagens para aprovar aparecem neste
        sino.
      </p>
    );
  }

  return (
    <div className="flex flex-col">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b px-5 py-3">
        <p className="text-sm text-muted-foreground tabular-nums">
          {naoLidas === 0 ? "Tudo lido" : naoLidas === 1 ? "1 não lida" : `${naoLidas} não lidas`}
        </p>
        {naoLidas > 0 && (
          <Button type="button" variant="outline" className="h-11 md:h-9" disabled={pendente} onClick={marcarTodas}>
            Marcar todas como lidas
          </Button>
        )}
      </div>

      {erro !== null && (
        <Alert variant="destructive" role="alert" className="mx-5 mt-3 w-auto">
          <AlertDescription>{erro}</AlertDescription>
        </Alert>
      )}

      <ul aria-label="Notificações" className="flex flex-col divide-y">
        {items.map((item) => {
          const lida = item.readAt !== null;
          const { text } = describeNotification(item);

          return (
            <li key={item.id}>
              <button
                type="button"
                disabled={pendente}
                onClick={() => abrir(item.id)}
                className="flex min-h-14 w-full items-start gap-3 px-5 py-3.5 text-left hover:bg-muted focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none disabled:opacity-70"
              >
                <span
                  aria-hidden
                  className={cn("mt-1.5 size-2 shrink-0 rounded-full", lida ? "bg-transparent" : "bg-highlight")}
                />
                <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                  <span className={cn("text-sm", lida ? "font-normal" : "font-semibold")}>
                    {lida ? null : <span className="sr-only">Não lida: </span>}
                    {text}
                  </span>
                  <span className="text-[13px] text-muted-foreground tabular-nums">
                    <LocalDate iso={item.createdAt} format="comHora" />
                  </span>
                </span>
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
