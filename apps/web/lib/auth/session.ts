import "server-only";
import { cache } from "react";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import type { Permission, SessionInfo } from "@repo/shared";
import { can } from "@repo/shared";
import { ApiError, apiFetch } from "../api/client";
import { SESSION_COOKIE } from "./cookies";

/**
 * Quem está logado, do lado do Next.
 *
 * ⚠️ **`cache()` do React**: `getSession()` é chamado pela página, por vários
 * componentes e pela Server Action da mesma requisição. Sem ele, cada chamada
 * vira uma consulta à API — a falha registrada no `nossobuncker`. Com ele, é uma
 * por requisição.
 */
export const getSession = cache(async (): Promise<SessionInfo | null> => {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  if (token === undefined) return null;

  try {
    return await apiFetch<SessionInfo>({ method: "GET", path: "/auth/session", token });
  } catch (error) {
    // Sessão revogada, vencida por inatividade ou pelo teto chega como 401. Para
    // quem chama, é tudo "não está logado".
    if (error instanceof ApiError && error.status === 401) return null;
    throw error;
  }
});

/**
 * Exige sessão em **cada página e cada Server Action** (AGENTS.md, regra 5).
 *
 * ⚠️ Nunca confie só no `proxy.ts`: ele olha a presença do cookie, não a
 * validade dele. E **nunca** decida acesso num `layout.tsx` — layouts não
 * re-renderizam na troca de rota, então a sessão não seria conferida de novo.
 *
 * O destino do desvio depende de haver cookie ou não. Com cookie presente e
 * sessão inválida, mandar para `/entrar` criaria um laço: o proxy vê o cookie e
 * devolve para a página, que pergunta à API e volta para `/entrar`. Quem quebra
 * o laço é `/sessao-expirada`, que apaga o cookie depois de conferir.
 */
export async function requireSession(): Promise<SessionInfo> {
  const session = await getSession();
  if (session !== null) return session;

  const temCookie = (await cookies()).get(SESSION_COOKIE) !== undefined;
  redirect(temCookie ? "/sessao-expirada" : "/entrar");
}

/**
 * Esconde o que a pessoa não pode fazer. **Não é proteção** — quem decide é a
 * API (AGENTS.md, regra 17); isto evita mostrar botão que vai dar erro.
 */
export async function hasPermission(permission: Permission): Promise<boolean> {
  const session = await getSession();
  return session !== null && can(session.user, permission);
}
