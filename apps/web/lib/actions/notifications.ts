"use server";

import { revalidatePath } from "next/cache";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import type { NotificationItem } from "@repo/shared";
import { apiFetch } from "../api/client";
import { SESSION_COOKIE } from "../auth/cookies";
import { requireSession } from "../auth/session";
import { describeNotification } from "../notifications/describe";
import { failure, success, type ActionResult } from "./result";

/**
 * O sino (RF-J01): abrir um aviso, marcar todos, e o número para a casca.
 *
 * ⚠️ **Abrir é Server Action, e não uma página GET que marca como lido.** O Next
 * faz prefetch dos links à vista: uma página que marcasse ao carregar marcaria
 * avisos que ninguém abriu (regra 13 — GET sem efeito).
 *
 * Toda ação chama `revalidatePath("/", "layout")`: o número do sino vem do layout
 * autenticado, e sem isso a casca continuaria mostrando o de antes (regra 26).
 */

/** Marca como lido e leva à tela do aviso. O destino é montado com os dados de agora. */
export async function openNotificationAction(notificationId: string): Promise<ActionResult> {
  await requireSession();
  const token = (await cookies()).get(SESSION_COOKIE)?.value;

  let destino: string;
  try {
    const aviso = await apiFetch<NotificationItem>({
      method: "POST",
      path: `/notifications/${encodeURIComponent(notificationId)}/read`,
      body: {},
      token,
    });
    destino = describeNotification(aviso).href;
  } catch (error) {
    revalidatePath("/", "layout");
    return failure(error);
  }

  revalidatePath("/", "layout");
  // Fora do try: o `redirect` lança de propósito, e o catch o engoliria.
  redirect(destino);
}

export async function markAllNotificationsReadAction(): Promise<ActionResult<{ updated: number }>> {
  await requireSession();
  const token = (await cookies()).get(SESSION_COOKIE)?.value;

  try {
    const resultado = await apiFetch<{ updated: number }>({
      method: "POST",
      path: "/notifications/read-all",
      body: {},
      token,
    });
    revalidatePath("/", "layout");
    return success(resultado);
  } catch (error) {
    return failure(error);
  }
}

/**
 * O número do sino, para a consulta de 60 s da casca.
 *
 * É leitura por Server Action, e não por rota GET: a chave de sessão fica no
 * servidor e o navegador não fala com a API (regra 4). `null` quando falha — a
 * casca mantém o número que tinha.
 */
export async function unreadCountAction(): Promise<number | null> {
  await requireSession();
  const token = (await cookies()).get(SESSION_COOKIE)?.value;

  try {
    return (await apiFetch<{ count: number }>({ method: "GET", path: "/notifications/unread-count", token })).count;
  } catch {
    return null;
  }
}
