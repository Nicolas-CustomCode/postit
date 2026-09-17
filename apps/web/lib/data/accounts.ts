import "server-only";
import { cache } from "react";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import type { AccountSummary } from "@repo/shared";
import { ApiError, apiFetch } from "../api/client";
import { SESSION_COOKIE } from "../auth/cookies";

/**
 * As contas conectadas.
 *
 * `cache()` do React porque a casca, o seletor e a página pedem a mesma lista na
 * mesma requisição — sem ele, seriam três chamadas à API por tela.
 */
export const listAccounts = cache(async (): Promise<AccountSummary[]> => {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;

  try {
    return await apiFetch<AccountSummary[]>({ method: "GET", path: "/accounts", token });
  } catch (error) {
    // A sessão pode morrer entre a conferência da página e esta leitura.
    if (error instanceof ApiError && error.status === 401) redirect("/sessao-expirada");
    throw error;
  }
});
