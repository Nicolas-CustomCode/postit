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

/**
 * A autorização voltou sem `state` válido: expirada, adulterada, já usada, ou de
 * outra pessoa. **Um erro só, de propósito** — distinguir os casos diria a quem
 * forja um retorno o que ele acertou.
 */
export class ConnectionInvalidError extends AppError {
  constructor() {
    super("CONNECTION_INVALID", 400);
  }
}

/** A conta autorizada não é profissional; a tela explica como mudar (RF-A08). */
export class AccountNotProfessionalError extends AppError {
  constructor() {
    super("ACCOUNT_NOT_PROFESSIONAL", 422);
  }
}

/** Enquanto o app está em desenvolvimento, só conta testadora entra (docs/08). */
export class AccountNotTesterError extends AppError {
  constructor() {
    super("ACCOUNT_NOT_TESTER", 422);
  }
}

/**
 * A Meta não respondeu, demorou demais ou devolveu algo que não sabemos ler.
 *
 * Nunca carrega a mensagem da Meta: ela pode trazer de volta o que mandamos,
 * inclusive o token na query string (AGENTS.md, regra 3).
 */
export class InstagramUnavailableError extends AppError {
  constructor() {
    super("INSTAGRAM_UNAVAILABLE", 502);
  }
}

/** Conectar de novo a mesma conta é engano comum; dizer isso evita duplicata. */
export class AccountAlreadyConnectedError extends AppError {
  constructor() {
    super("ACCOUNT_ALREADY_CONNECTED", 409);
  }
}

/**
 * O acesso à conta morreu: a pessoa revogou o app, trocou a senha do Instagram,
 * ou o token passou dos 60 dias sem renovar (docs/08).
 *
 * Diferente de `INSTAGRAM_UNAVAILABLE`: aquele é a Meta fora do ar, e passa
 * sozinho. Este exige alguém reconectar a conta, e dizer "tente de novo em
 * alguns minutos" faria a pessoa esperar por algo que nunca vai acontecer.
 */
export class AccountAccessExpiredError extends AppError {
  constructor() {
    super("ACCOUNT_ACCESS_EXPIRED", 422);
  }
}

/**
 * Mídia recusada na validação (RF-B02). Um erro por regra, e não um genérico:
 * o docs/04 é literal ao dizer que a tela mostra "JPEG de até 8 MB. Este
 * arquivo tem 12 MB", nunca "arquivo inválido". Quem enviou precisa saber qual
 * regra pegou e qual é o limite — a tela completa a frase com o tamanho que ela
 * mesma mediu antes de enviar.
 *
 * 422 e não 400: a requisição está bem formada; o conteúdo é que não serve.
 */
export class MediaWrongTypeError extends AppError {
  constructor() {
    super("MEDIA_WRONG_TYPE", 422);
  }
}

export class MediaTooLargeError extends AppError {
  constructor() {
    super("MEDIA_TOO_LARGE", 422);
  }
}

export class MediaTooNarrowError extends AppError {
  constructor() {
    super("MEDIA_TOO_NARROW", 422);
  }
}

export class MediaRatioUnsupportedError extends AppError {
  constructor() {
    super("MEDIA_RATIO_UNSUPPORTED", 422);
  }
}

/** Os bytes não formam uma imagem que dê para ler — nem as medidas saem. */
export class MediaCorruptError extends AppError {
  constructor() {
    super("MEDIA_CORRUPT", 422);
  }
}

/**
 * O comprovante de envio não vale: forjado, vencido, ou de outra pessoa.
 *
 * **Um erro só para os quatro motivos**, como no `state` do OAuth: distinguir
 * diria a quem forja exatamente o que ele acertou.
 */
export class MediaUploadInvalidError extends AppError {
  constructor() {
    super("MEDIA_UPLOAD_INVALID", 400);
  }
}

/**
 * Confirmar duas vezes o mesmo envio.
 *
 * Acontece de verdade: a tela repete a chamada depois de um tempo esgotado que
 * na verdade tinha dado certo. Sem este erro, a segunda tentativa estoura a
 * unicidade de `chaveObjeto` e o filtro global a transforma em "Algo deu
 * errado" — o pior desfecho, porque o arquivo está lá e funcionando.
 */
export class MediaAlreadyConfirmedError extends AppError {
  constructor() {
    super("MEDIA_ALREADY_CONFIRMED", 409);
  }
}

/**
 * A imagem está presa a uma postagem viva ou publicada (RF-B07).
 *
 * **409 e não 422:** a requisição está perfeita, é o **estado** que conflita —
 * mesma família de `MEDIA_ALREADY_CONFIRMED`, `POST_NOT_EDITABLE` e
 * `LAST_SUPER_ADMIN`. O 422 deste arquivo é reservado a "o conteúdo não serve".
 */
export class MediaInUseError extends AppError {
  constructor() {
    super("MEDIA_IN_USE", 409);
  }
}

/**
 * A postagem não existe **nesta conta**.
 *
 * ⚠️ **404, e não 403, também quando a postagem existe em outra conta.** Dizer
 * "existe, mas não é sua" já entrega que aquele identificador é real. O `where`
 * das consultas sempre carrega `contaId` junto do id, e é esta a resposta dos
 * dois casos (AGENTS.md, regra 24).
 */
export class PostNotFoundError extends AppError {
  constructor() {
    super("POST_NOT_FOUND", 404);
  }
}

/**
 * Outra pessoa salvou enquanto esta editava (RF-C12).
 *
 * Carrega **quem** e **quando** porque a tela precisa dizer "Esta postagem foi
 * alterada por Fulano às 14h32" no mesmo instante do aviso. Os dados vêm da
 * consulta que já aconteceu dentro da transação — buscá-los depois seria uma
 * corrida, e mostraria o nome errado justamente no caso em que a funcionalidade
 * existe para não mentir.
 */
export class PostVersionConflictError extends AppError {
  constructor(current: { updatedByName: string | null; updatedAt: Date; version: number }) {
    super("POST_VERSION_CONFLICT", 409, {
      conflict: {
        updatedByName: current.updatedByName,
        updatedAt: current.updatedAt.toISOString(),
        version: current.version,
      },
    });
  }
}

/** A transição pedida não existe na máquina de estados (docs/05). */
export class PostTransitionInvalidError extends AppError {
  constructor() {
    super("POST_TRANSITION_INVALID", 409);
  }
}

/** `PUBLICADO`, `CANCELADO` e `PROCESSANDO` não aceitam edição de conteúdo. */
export class PostNotEditableError extends AppError {
  constructor() {
    super("POST_NOT_EDITABLE", 409);
  }
}

/**
 * Falta algo para a postagem sair do rascunho.
 *
 * O código diz o quê: imagem ausente, legenda fora dos limites, ou imagem que
 * não serve a este formato. Os códigos de mídia aparecem aqui de propósito — o
 * acervo aceitou a imagem porque ela serve a algum formato, e é este que não a
 * aceita (RF-B03).
 */
export class PostNotReadyError extends AppError {
  constructor(
    code:
      | "POST_MEDIA_REQUIRED"
      | "POST_TOO_MANY_MEDIA"
      | "POST_FORMAT_SINGLE_MEDIA"
      | "POST_CAPTION_TOO_LONG"
      | "POST_TOO_MANY_HASHTAGS"
      | "POST_TOO_MANY_MENTIONS"
      | "MEDIA_WRONG_TYPE"
      | "MEDIA_TOO_LARGE"
      | "MEDIA_TOO_NARROW"
      | "MEDIA_RATIO_UNSUPPORTED",
  ) {
    super(code, 422);
  }
}

/** O comentário não existe — ou é de uma postagem de outra conta (regra 24). */
export class CommentNotFoundError extends AppError {
  constructor() {
    super("COMMENT_NOT_FOUND", 404);
  }
}

/** Excluir comentário de outra pessoa (ADR 0026). */
export class CommentNotYoursError extends AppError {
  constructor() {
    super("COMMENT_NOT_YOURS", 403);
  }
}

/** Excluir depois dos 5 minutos (ADR 0026): o comentário já é parte da conversa. */
export class CommentDeleteExpiredError extends AppError {
  constructor() {
    super("COMMENT_DELETE_EXPIRED", 409);
  }
}

/** Aprovar a própria postagem sem `POSTAGEM_APROVAR_PROPRIA` (RF-I04). */
export class SelfApprovalForbiddenError extends AppError {
  constructor() {
    super("SELF_APPROVAL_FORBIDDEN", 403);
  }
}

/**
 * O horário escolhido não existe naquele dia (ADR 0006).
 *
 * Acontece na madrugada em que o relógio pula uma hora. Recusar é a decisão
 * registrada: ajustar sozinho publicaria em horário que ninguém pediu.
 */
export class ScheduleTimeDoesNotExistError extends AppError {
  constructor() {
    super("SCHEDULE_TIME_DOES_NOT_EXIST", 422);
  }
}

/** Agendar para trás (RF-D03). O minuto corrente ainda conta como futuro. */
export class ScheduleInPastError extends AppError {
  constructor() {
    super("SCHEDULE_IN_PAST", 422);
  }
}
