import { AUTH_ERROR_MESSAGES, type ApiErrorBody, type AuthErrorCode } from "@repo/shared";

/**
 * Os erros que a API devolve de propósito.
 *
 * Cada um carrega o código do vocabulário fechado de @repo/shared, e a tela
 * decide por ele — nunca pelo texto. O filtro global traduz para HTTP.
 *
 * Nada aqui aceita "detalhe livre": o que entra no corpo é só o que está
 * declarado, para nunca sair token, código ou senha por descuido.
 */
export class AppError extends Error {
  constructor(
    readonly code: AuthErrorCode,
    readonly status: number,
    readonly extra: Omit<ApiErrorBody, "code" | "message"> = {},
  ) {
    super(AUTH_ERROR_MESSAGES[code]);
    this.name = "AppError";
  }

  body(): ApiErrorBody {
    return { code: this.code, message: this.message, ...this.extra };
  }
}

/** E-mail inexistente e senha errada: o MESMO erro, de propósito (ADR 0013). */
export class InvalidCredentialsError extends AppError {
  constructor() {
    super("INVALID_CREDENTIALS", 401);
  }
}

/** Só aparece depois da senha certa; antes disso, revelaria contas existentes. */
export class AccountDeactivatedError extends AppError {
  constructor() {
    super("ACCOUNT_DEACTIVATED", 403);
  }
}

/** 429 com o horário: "tente mais tarde" sem dizer quando é o mesmo que nada. */
export class AccessBlockedError extends AppError {
  constructor(until: Date) {
    super("ACCESS_BLOCKED", 429, { blockedUntil: until.toISOString() });
  }
}

/** Desafio inexistente, expirado, esgotado ou já usado — um erro só. */
export class ChallengeInvalidError extends AppError {
  constructor() {
    super("CHALLENGE_INVALID", 400);
  }
}

export class InvalidCodeError extends AppError {
  constructor() {
    super("INVALID_CODE", 401);
  }
}

/** Link inexistente, vencido, já usado ou de outra finalidade — um erro só. */
export class AccessLinkInvalidError extends AppError {
  constructor() {
    super("ACCESS_LINK_INVALID", 400);
  }
}

/** O motivo vem de passwordProblem(), e é o que a tela mostra no campo. */
export class PasswordPolicyError extends AppError {
  constructor(readonly problem: string) {
    super("PASSWORD_POLICY", 400, { fields: ["password"] });
  }
}

export class ValidationFailedError extends AppError {
  constructor(fields: readonly string[]) {
    super("VALIDATION_FAILED", 400, { fields });
  }
}

export class UnauthenticatedError extends AppError {
  constructor() {
    super("UNAUTHENTICATED", 401);
  }
}

export class ForbiddenError extends AppError {
  constructor(code: Extract<AuthErrorCode, "FORBIDDEN" | "ROUTE_WITHOUT_POLICY" | "RECENT_CONFIRMATION_REQUIRED"> = "FORBIDDEN") {
    super(code, 403);
  }
}

/** Invariante I-10: nunca zero super admin ativo (docs/05). */
export class LastSuperAdminError extends AppError {
  constructor() {
    super("LAST_SUPER_ADMIN", 409);
  }
}

export class SelfDeactivationError extends AppError {
  constructor() {
    super("SELF_DEACTIVATION", 409);
  }
}
