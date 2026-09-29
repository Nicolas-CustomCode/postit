import "server-only";
import { cookies } from "next/headers";
import type { OAuthAuthorizeInput, OAuthRequestDescription } from "@repo/shared";
import { apiFetch } from "../api/client";
import { SESSION_COOKIE } from "../auth/cookies";

/** O pedido de autorização do assistente, conferido pela API (ADR 0029). */
export async function describeOAuthRequest(input: OAuthAuthorizeInput): Promise<OAuthRequestDescription> {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  const query = new URLSearchParams(
    Object.entries(input).filter((entry): entry is [string, string] => entry[1] !== undefined),
  );
  return apiFetch<OAuthRequestDescription>({ method: "GET", path: `/oauth/requests?${query}`, token });
}
