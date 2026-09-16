"use server";

import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
import { changePasswordSchema, confirmCodeSchema } from "@repo/shared";
import { apiFetch } from "../api/client";
import { SESSION_COOKIE } from "../auth/cookies";
import { failure, success, type ActionResult } from "./result";

/**
 * As escritas do perfil: trocar senha, gerar códigos novos e encerrar as outras
 * sessões. Todas exigem sessão — a API confere de novo, sempre.
 */

async function sessionToken(): Promise<string | undefined> {
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
