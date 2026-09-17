import "server-only";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import type { SecurityOverview } from "@repo/shared";
import { ApiError, apiFetch } from "../api/client";
import { SESSION_COOKIE } from "../auth/cookies";

/**
 * O estado de segurança da própria conta, para a tela de Perfil.
 *
 * Rota própria, e não um campo a mais em `/auth/session`: aquela é consultada a
 * cada render de página pelo `requireSession()`, e contar códigos de recuperação
 * em toda requisição seria custo puro.
 */
export async function getSecurityOverview(): Promise<SecurityOverview> {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;

  try {
    return await apiFetch<SecurityOverview>({ method: "GET", path: "/auth/security", token });
  } catch (error) {
    // Mesmo desvio de listActiveSessions: a sessão pode morrer entre a
    // conferência da página e esta leitura, e isso não é erro de servidor.
    if (error instanceof ApiError && error.status === 401) redirect("/sessao-expirada");
    throw error;
  }
}
