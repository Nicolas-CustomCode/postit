import { AUTH_ERROR_MESSAGES, type AuthErrorCode } from "@repo/shared";
import { ApiError } from "../api/client";

/**
 * O que toda Server Action devolve.
 *
 * ⚠️ Server Action **devolve**, não lança: uma exceção atravessando a fronteira
 * vira "algo deu errado" na tela, e a pessoa perde o que digitou. Aqui volta uma
 * mensagem em português e, quando é bloqueio, até que horas.
 */
export interface ActionError {
  readonly code: AuthErrorCode;
  readonly message: string;
  /** Só em ACCESS_BLOCKED: o horário de liberação, já formatado. */
  readonly blockedUntil?: string;
}

export type ActionResult<T = undefined> = { ok: true; data: T } | ({ ok: false } & ActionError);

export function failure(error: unknown): ActionResult<never> {
  if (error instanceof ApiError) {
    return {
      ok: false,
      code: error.code,
      message: messageFor(error),
      ...(error.blockedUntil === undefined ? {} : { blockedUntil: error.blockedUntil }),
    };
  }

  // Erro que não veio da API (rede, por exemplo): mensagem genérica, e o erro
  // cru fica no log do servidor, não na tela.
  console.error(error);
  return { ok: false, code: "INTERNAL_ERROR", message: AUTH_ERROR_MESSAGES.INTERNAL_ERROR };
}

export function success<T>(data: T): ActionResult<T> {
  return { ok: true, data };
}

/** "Tente mais tarde" sem dizer quando é o mesmo que não dizer nada. */
function messageFor(error: ApiError): string {
  if (error.code !== "ACCESS_BLOCKED" || error.blockedUntil === undefined) return error.message;

  const horario = new Date(error.blockedUntil).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
  return `Muitas tentativas. Tente de novo a partir das ${horario}`;
}
