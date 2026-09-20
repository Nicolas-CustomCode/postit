import "server-only";
import { cache } from "react";
import { cookies } from "next/headers";
import { notFound, redirect } from "next/navigation";
import type { AccountSummary, PostDetail, PostSummary } from "@repo/shared";
import { ApiError, apiFetch } from "../api/client";
import { SESSION_COOKIE } from "../auth/cookies";
import { listAccounts } from "./accounts";

/**
 * As postagens da conta ativa.
 *
 * ⚠️ **A API fala por identificador; o endereço da tela fala por @.** A tradução
 * acontece aqui, com a lista que o `cache()` do React já guardou para esta
 * requisição — então não custa uma chamada a mais. É de propósito: o @ muda no
 * Instagram e o identificador não, e guardar o @ no `where` transformaria uma
 * troca de nome numa postagem órfã.
 */
export const accountFor = cache(async (username: string): Promise<AccountSummary> => {
  const account = (await listAccounts()).find((item) => item.username === username);
  // O layout de `/c/[conta]` já barra conta desconhecida; isto cobre quem chegar
  // por outro caminho.
  if (account === undefined) notFound();

  return account;
});

export const accountIdFor = cache(async (username: string): Promise<string> => (await accountFor(username)).id);

export const listPosts = cache(async (username: string): Promise<PostSummary[]> => {
  const accountId = await accountIdFor(username);
  return call<PostSummary[]>(`/accounts/${accountId}/posts`);
});

export const getPost = cache(async (username: string, postId: string): Promise<PostDetail> => {
  const accountId = await accountIdFor(username);

  try {
    return await call<PostDetail>(`/accounts/${accountId}/posts/${postId}`);
  } catch (error) {
    // Postagem de outra conta responde 404 na API de propósito (regra 24): dizer
    // "existe, mas não é sua" já entregaria que o identificador é real.
    if (error instanceof ApiError && error.status === 404) notFound();
    throw error;
  }
});

async function call<T>(path: string): Promise<T> {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;

  try {
    return await apiFetch<T>({ method: "GET", path, token });
  } catch (error) {
    // A sessão pode morrer entre a conferência da página e esta leitura.
    if (error instanceof ApiError && error.status === 401) redirect("/sessao-expirada");
    throw error;
  }
}
