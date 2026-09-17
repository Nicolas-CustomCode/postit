"use server";

import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
import { changePasswordSchema, confirmCodeSchema, sessionIdSchema } from "@repo/shared";
import { apiFetch } from "../api/client";
import { SESSION_COOKIE } from "../auth/cookies";
import { requireSession } from "../auth/session";
import { failure, success, type ActionResult } from "./result";

/**
 * As escritas do perfil: trocar senha, gerar códigos novos e encerrar sessões.
 *
 * Toda ação chama `requireSession()` antes de falar com a API (AGENTS.md, regra
 * 5). Não é o que protege — quem decide é a API, que confere o token de novo —,
 * mas é o que faz a pessoa sem sessão cair no login em vez de receber um erro
 * cru vindo de dentro.
 */

async function sessionToken(): Promise<string | undefined> {
  await requireSession();
  return (await cookies()).get(SESSION_COOKIE)?.value;
}

/** Exige senha atual E código do aplicativo; derruba as outras sessões. */
export async function changePasswordAction(
  _previous: unknown,
  form: FormData,
): Promise<ActionResult<{ revoked: number }>> {
  const senhaNova = form.get("newPassword")?.toString() ?? "";
  if (senhaNova !== (form.get("confirmation")?.toString() ?? "")) {
    return { ok: false, code: "VALIDATION_FAILED", message: "As duas senhas não são iguais" };
  }

  const entrada = changePasswordSchema.safeParse({
    currentPassword: form.get("currentPassword"),
    newPassword: senhaNova,
    code: form.get("code"),
  });
  if (!entrada.success) return { ok: false, code: "VALIDATION_FAILED", message: "Preencha todos os campos" };

  try {
    const resultado = await apiFetch<{ revoked: number }>({
      method: "POST",
      path: "/auth/password",
      body: entrada.data,
      token: await sessionToken(),
    });
    revalidatePath("/perfil");
    return success(resultado);
  } catch (error) {
    return failure(error);
  }
}

/** Os códigos anteriores param de valer no mesmo instante. */
export async function regenerateRecoveryCodesAction(
  _previous: unknown,
  form: FormData,
): Promise<ActionResult<{ codes: readonly string[] }>> {
  const entrada = confirmCodeSchema.safeParse({ code: form.get("code") });
  if (!entrada.success) return { ok: false, code: "INVALID_CODE", message: "Digite o código do aplicativo" };

  try {
    const resultado = await apiFetch<{ codes: string[] }>({
      method: "POST",
      path: "/auth/recovery-codes",
      body: entrada.data,
      token: await sessionToken(),
    });
    return success(resultado);
  } catch (error) {
    return failure(error);
  }
}

/**
 * Encerra **um** aparelho da lista.
 *
 * A API responde 204 mesmo quando não encerra nada — de propósito, para não
 * revelar de quem é aquele id. Quem mostra o resultado é a lista, relida pelo
 * `revalidatePath`.
 */
export async function revokeSessionAction(_previous: unknown, form: FormData): Promise<ActionResult<null>> {
  const id = sessionIdSchema.safeParse(form.get("sessionId"));
  if (!id.success) return { ok: false, code: "VALIDATION_FAILED", message: "Aparelho inválido" };

  try {
    await apiFetch<void>({ method: "POST", path: `/auth/sessions/${id.data}/revoke`, token: await sessionToken() });
    revalidatePath("/perfil");
    return success(null);
  } catch (error) {
    return failure(error);
  }
}

/** Mantém este aparelho e encerra os demais. */
export async function revokeOtherSessionsAction(): Promise<ActionResult<{ revoked: number }>> {
  try {
    const resultado = await apiFetch<{ revoked: number }>({
      method: "POST",
      path: "/auth/sessions/revoke-others",
      token: await sessionToken(),
    });
    revalidatePath("/perfil");
    return success(resultado);
  } catch (error) {
    return failure(error);
  }
}
