import "server-only";
import { cache } from "react";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import type { NotificationItem } from "@repo/shared";
import { ApiError, apiFetch } from "../api/client";
import { SESSION_COOKIE } from "../auth/cookies";

/**
 * O sino de quem está logado (RF-J01). Sem conta: a tela é geral e lista os
 * avisos de todas as contas (docs/13).
 */
export const listNotifications = cache(async (): Promise<NotificationItem[]> => {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;

  try {
    return await apiFetch<NotificationItem[]>({ method: "GET", path: "/notifications", token });
  } catch (error) {
    if (error instanceof ApiError && error.status === 401) redirect("/sessao-expirada");
    throw error;
  }
});

/**
 * O número do sino, para a casca.
 *
 * ⚠️ **Nunca derruba a tela.** Ele é lido no layout, em toda página: uma falha
 * aqui não pode transformar qualquer tela em erro. Sem número, o sino aparece sem
 * selo, e a consulta de 60 s tenta de novo.
 */
export const unreadNotificationCount = cache(async (): Promise<number> => {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;

  try {
    return (await apiFetch<{ count: number }>({ method: "GET", path: "/notifications/unread-count", token })).count;
  } catch (error) {
    if (error instanceof ApiError && error.status === 401) redirect("/sessao-expirada");
    console.error(error);
    return 0;
  }
});
