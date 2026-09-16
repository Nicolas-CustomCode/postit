import "server-only";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import type { ActiveSession } from "@repo/shared";
import { ApiError, apiFetch } from "../api/client";
import { SESSION_COOKIE } from "../auth/cookies";

/** Leituras usadas por Server Components ficam em lib/data (docs/06). */
export async function listActiveSessions(): Promise<ActiveSession[]> {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;

  try {
    return await apiFetch<ActiveSession[]>({ method: "GET", path: "/auth/sessions", token });
  } catch (error) {
    // A sessão pode morrer entre a conferência da página e esta leitura — é o
    // que acontece quando a pessoa sai num aparelho enquanto a tela carrega no
    // outro. Sem este desvio, vira erro cru no servidor e tela de falha.
    if (error instanceof ApiError && error.status === 401) redirect("/sessao-expirada");
    throw error;
  }
}
