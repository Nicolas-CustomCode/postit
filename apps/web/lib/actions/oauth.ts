"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { oauthAuthorizeSchema, type OAuthApproval, type OAuthAuthorizeInput } from "@repo/shared";
import { apiFetch } from "../api/client";
import { requireSession } from "../auth/session";
import { SESSION_COOKIE } from "../auth/cookies";
import { describeOAuthRequest } from "../data/oauth";
import { failure, type ActionResult } from "./result";

/**
 * "Permitir" e "Recusar" da tela de permissão do assistente (ADR 0029).
 *
 * O `redirect()` final leva a pessoa de volta ao ChatGPT. É para fora do PostIt e não
 * passa por `safeRedirect()` (regra 14) porque o destino **não vem da URL**: vem da
 * API, que só o monta sobre um endereço de retorno registrado pelo próprio cliente.
 *
 * Os parâmetros do pedido chegam de novo pelo formulário e a API confere tudo outra
 * vez — o formulário é da pessoa, mas quem o preencheu foi o link que o ChatGPT abriu.
 */

function readRequest(form: FormData): OAuthAuthorizeInput | null {
  const fields = Object.fromEntries(
    [...form.entries()].filter(([name, value]) => !name.startsWith("$") && typeof value === "string" && value !== ""),
  );
  const parsed = oauthAuthorizeSchema.safeParse(fields);
  return parsed.success ? parsed.data : null;
}

export async function approveAssistantAction(_previous: unknown, form: FormData): Promise<ActionResult<never>> {
  await requireSession();
  const input = readRequest(form);
  if (input === null) return { ok: false, code: "VALIDATION_FAILED", message: "O pedido de autorização está incompleto" };

  let approval: OAuthApproval;
  try {
    const token = (await cookies()).get(SESSION_COOKIE)?.value;
    approval = await apiFetch<OAuthApproval>({ method: "POST", path: "/oauth/approve", body: input, token });
  } catch (error) {
    return failure(error);
  }
  redirect(approval.redirectTo);
}

export async function denyAssistantAction(_previous: unknown, form: FormData): Promise<ActionResult<never>> {
  await requireSession();
  const input = readRequest(form);
  if (input === null) return { ok: false, code: "VALIDATION_FAILED", message: "O pedido de autorização está incompleto" };

  let destino: string;
  try {
    const description = await describeOAuthRequest(input);
    if (description.kind === "INVALID") return { ok: false, code: "VALIDATION_FAILED", message: description.reason };
    destino = description.kind === "READY" ? description.denyRedirect : description.redirectTo;
  } catch (error) {
    return failure(error);
  }
  redirect(destino);
}
