import "server-only";
import { cache } from "react";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import type { MediaSummary } from "@repo/shared";
import { ApiError, apiFetch } from "../api/client";
import { SESSION_COOKIE } from "../auth/cookies";

/**
 * O acervo (RF-B04).
 *
 * Não recebe conta: a `Midia` não tem dono no schema, e o acervo é compartilhado
 * de propósito — a mesma foto serve a qualquer conta e a qualquer formato
 * (docs/13, "Acervo").
 */
export const listMedia = cache(async (): Promise<MediaSummary[]> => {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;

  try {
    return await apiFetch<MediaSummary[]>({ method: "GET", path: "/media", token });
  } catch (error) {
    // A sessão pode morrer entre a conferência da página e esta leitura.
    if (error instanceof ApiError && error.status === 401) redirect("/sessao-expirada");
    throw error;
  }
});
