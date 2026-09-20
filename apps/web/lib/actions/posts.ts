"use server";

import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
import { apiFetch } from "../api/client";
import { SESSION_COOKIE } from "../auth/cookies";
import { requireSession } from "../auth/session";
import { accountIdFor } from "../data/posts";
import { failure, success, type ActionResult } from "./result";

/**
 * Compor postagens (RF-C01, RF-C03, RF-C12).
 *
 * Escrita no Next é sempre Server Action (regra 13), e cada uma confere a sessão
 * por conta própria — nunca só pelo `proxy.ts` (regra 5).
 *
 * ⚠️ **Tudo é `POST`, inclusive o que pareceria `PATCH`.** O `apiFetch` conhece
 * só `GET` e `POST`, e o projeto já resolve isso com caminho-verbo. A versão
 * viaja em toda escrita: é ela que faz a API recusar quando outra pessoa salvou
 * no meio (RF-C12).
 */

export async function createPostAction(
  username: string,
  input: { caption: string | null },
): Promise<ActionResult<{ id: string }>> {
  return write(username, (accountId) => ({
    path: `/accounts/${accountId}/posts`,
    body: { format: "FEED_IMAGE", caption: input.caption },
  }));
}

export async function setCaptionAction(
  username: string,
  postId: string,
  input: { version: number; caption: string | null },
): Promise<ActionResult<{ version: number }>> {
  return write(username, (accountId) => ({
    path: `/accounts/${accountId}/posts/${postId}/caption`,
    body: input,
  }));
}

export async function setPostMediaAction(
  username: string,
  postId: string,
  input: { version: number; mediaId: string; altText: string | null },
): Promise<ActionResult<{ version: number }>> {
  return write(username, (accountId) => ({
    path: `/accounts/${accountId}/posts/${postId}/media`,
    body: input,
  }));
}

export async function markPostReadyAction(
  username: string,
  postId: string,
  input: { version: number },
): Promise<ActionResult<{ version: number }>> {
  return write(username, (accountId) => ({
    path: `/accounts/${accountId}/posts/${postId}/ready`,
    body: input,
  }));
}

export async function discardPostAction(
  username: string,
  postId: string,
  input: { version: number },
): Promise<ActionResult<{ version: number }>> {
  return write(username, (accountId) => ({
    path: `/accounts/${accountId}/posts/${postId}/discard`,
    body: input,
  }));
}

/**
 * O caminho comum de toda escrita: sessão, token, chamada, revalidação.
 *
 * O `revalidatePath` do caminho da conta atualiza a lista e o detalhe de uma vez.
 * Não usa `revalidatePath("/", "layout")` — aqui nada muda a casca; essa regra é
 * das ações que mexem em **conta** (regra 26).
 */
async function write<T>(
  username: string,
  request: (accountId: string) => { path: string; body: unknown },
): Promise<ActionResult<T>> {
  await requireSession();
  const token = (await cookies()).get(SESSION_COOKIE)?.value;

  try {
    const accountId = await accountIdFor(username);
    const { path, body } = request(accountId);
    const data = await apiFetch<T>({ method: "POST", path, body, token });

    revalidatePath(`/c/${username}/postagens`);
    return success(data);
  } catch (error) {
    return failure(error);
  }
}
