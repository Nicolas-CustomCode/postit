import "server-only";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import type { ConnectedApp, OAuthAuthorizeInput, OAuthRequestDescription } from "@repo/shared";
import { ApiError, apiFetch } from "../api/client";
import { SESSION_COOKIE } from "../auth/cookies";

/** Os assistentes que a pessoa autorizou — o cartão "Aplicativos conectados" do Perfil. */
export async function listConnectedApps(): Promise<ConnectedApp[]> {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  try {
    return await apiFetch<ConnectedApp[]>({ method: "GET", path: "/oauth/grants", token });
  } catch (error) {
    if (error instanceof ApiError && error.status === 401) redirect("/sessao-expirada");
    throw error;
  }
}

/** O pedido de autorização do assistente, conferido pela API (ADR 0029). */
export async function describeOAuthRequest(input: OAuthAuthorizeInput): Promise<OAuthRequestDescription> {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  const query = new URLSearchParams(
    Object.entries(input).filter((entry): entry is [string, string] => entry[1] !== undefined),
  );
  return apiFetch<OAuthRequestDescription>({ method: "GET", path: `/oauth/requests?${query}`, token });
}
