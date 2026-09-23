"use server";

import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
import type { ComposableFormat } from "@repo/shared";
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
  input: { format: ComposableFormat; caption: string | null },
): Promise<ActionResult<{ id: string }>> {
  return write(username, (accountId) => ({
    path: `/accounts/${accountId}/posts`,
    body: { format: input.format, caption: input.caption },
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
  input: { version: number; media: readonly { mediaId: string; altText: string | null }[] },
): Promise<ActionResult<{ version: number }>> {
  return write(username, (accountId) => ({
    path: `/accounts/${accountId}/posts/${postId}/media`,
    body: input,
  }));
}

/**
 * Trocar o formato (RF-C02).
 *
 * A API revalida a imagem já anexada: uma arte 9:16 serve a Stories e não ao
 * feed, e é aqui que essa troca é recusada em vez de virar publicação errada.
 */
export async function setPostFormatAction(
  username: string,
  postId: string,
  input: { version: number; format: ComposableFormat },
): Promise<ActionResult<{ version: number }>> {
  return write(username, (accountId) => ({
    path: `/accounts/${accountId}/posts/${postId}/format`,
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

/**
 * Marcar horário — e reagendar, que é a mesma ação (RF-D01, RF-D04).
 *
 * Manda **dia e hora civis**: quem converte é a API, com o fuso da conta. Fazer
 * a conta aqui deixaria o fuso do aparelho entrar por engano (ADR 0006).
 */
export async function schedulePostAction(
  username: string,
  postId: string,
  input: { version: number; day: string; time: string },
): Promise<ActionResult<{ version: number }>> {
  return write(username, (accountId) => ({
    path: `/accounts/${accountId}/posts/${postId}/schedule`,
    body: input,
  }));
}

export async function cancelPostAction(
  username: string,
  postId: string,
  input: { version: number },
): Promise<ActionResult<{ version: number }>> {
  return write(username, (accountId) => ({
    path: `/accounts/${accountId}/posts/${postId}/cancel`,
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
 * `FALHOU → RASCUNHO`: voltar para corrigir antes de agendar de novo (ADR 0007).
 * O horário some, e a postagem precisa ser marcada como pronta outra vez.
 */
export async function revertPostToDraftAction(
  username: string,
  postId: string,
  input: { version: number },
): Promise<ActionResult<{ version: number }>> {
  return write(username, (accountId) => ({
    path: `/accounts/${accountId}/posts/${postId}/to-draft`,
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
