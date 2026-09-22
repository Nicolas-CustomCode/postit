"use server";

import { revalidatePath } from "next/cache";
import { cookies } from "next/headers";
import type { MediaSummary, UploadPermission } from "@repo/shared";
import { apiFetch } from "../api/client";
import { SESSION_COOKIE } from "../auth/cookies";
import { requireSession } from "../auth/session";
import { failure, success, type ActionResult } from "./result";

/**
 * Enviar mídia (RF-B01; ADR 0012).
 *
 * São duas ações porque o envio tem três passos, e **o do meio não passa por
 * aqui**: a primeira autoriza, o navegador manda o arquivo direto ao
 * armazenamento, e a segunda confirma. É o que permite um arquivo grande não
 * atravessar o Next nem a API.
 *
 * Escrita no Next é sempre Server Action (regra 13), e cada uma confere a sessão
 * por conta própria — nunca só pelo `proxy.ts` (regra 5).
 */

/** Para onde mandar o arquivo, com quais campos, e por quanto tempo vale. */
export async function requestUploadPermissionAction(): Promise<ActionResult<UploadPermission>> {
  await requireSession();
  const token = (await cookies()).get(SESSION_COOKIE)?.value;

  try {
    return success(
      await apiFetch<UploadPermission>({ method: "POST", path: "/media/upload-policy", token }),
    );
  } catch (error) {
    return failure(error);
  }
}

/**
 * Confirma o envio: é aqui que a API inspeciona o arquivo e decide.
 *
 * O `ticket` é opaco para a tela — ela só o repassa. Quem sabe qual objeto ele
 * representa, e de quem, é a API.
 */
export async function confirmUploadAction(ticket: string): Promise<ActionResult<MediaSummary>> {
  await requireSession();
  const token = (await cookies()).get(SESSION_COOKIE)?.value;

  try {
    return success(
      await apiFetch<MediaSummary>({ method: "POST", path: "/media/confirm", body: { ticket }, token }),
    );
  } catch (error) {
    return failure(error);
  }
}

/**
 * Tirar imagens do acervo (RF-B07).
 *
 * Uma lista sempre — a lixeira de um card manda um id só, e a API tem uma rota
 * só porque a regra de recusa é a mesma dos dois lados.
 *
 * ⚠️ **Revalida também no erro.** "Em uso" é quase sempre tela velha, e é o
 * redesenho que faz o card que segurou aparecer marcado. Sem isto, a pessoa
 * clica na mesma lixeira de novo e leva a mesma recusa.
 */
export async function deleteMediaAction(
  ids: readonly string[],
): Promise<ActionResult<{ deleted: number }>> {
  await requireSession();
  const token = (await cookies()).get(SESSION_COOKIE)?.value;

  try {
    const resultado = await apiFetch<{ deleted: number }>({
      method: "POST",
      path: "/media/delete",
      body: { ids },
      token,
    });
    revalidatePath("/acervo");
    return success(resultado);
  } catch (error) {
    revalidatePath("/acervo");
    return failure(error);
  }
}
