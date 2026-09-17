/**
 * Vocabulário fechado de erro da API.
 *
 * A tela decide pelo código, nunca pelo texto da mensagem: casar mensagem por
 * texto quebra em silêncio na primeira correção de português.
 *
 * ⚠️ E-mail inexistente e senha errada compartilham INVALID_CREDENTIALS de
 * propósito (ADR 0013, seção 5): códigos diferentes revelariam quais e-mails
 * existem, que é exatamente o que o hash isca evita no tempo de resposta.
 */
export const AUTH_ERROR_CODES = [
  "INVALID_CREDENTIALS",
  "ACCOUNT_DEACTIVATED",
  "ACCESS_BLOCKED",
  "CHALLENGE_INVALID",
  "INVALID_CODE",
  "ACCESS_LINK_INVALID",
  "PASSWORD_POLICY",
  "VALIDATION_FAILED",
  "UNAUTHENTICATED",
  "FORBIDDEN",
  "ROUTE_WITHOUT_POLICY",
  "RECENT_CONFIRMATION_REQUIRED",
  "LAST_SUPER_ADMIN",
  "SELF_DEACTIVATION",
  // Conexão de conta do Instagram (docs/08, "Fluxo de autorização").
  "CONNECTION_INVALID",
  "ACCOUNT_NOT_PROFESSIONAL",
  "ACCOUNT_NOT_TESTER",
  "INSTAGRAM_UNAVAILABLE",
  "ACCOUNT_ALREADY_CONNECTED",
  "INTERNAL_ERROR",
] as const;

export type AuthErrorCode = (typeof AUTH_ERROR_CODES)[number];

/** O corpo de erro que a API devolve. Nunca carrega token, código nem senha. */
export interface ApiErrorBody {
  readonly code: AuthErrorCode;
  readonly message: string;
  /** Só em ACCESS_BLOCKED: até quando o bloqueio vale, em ISO. */
  readonly blockedUntil?: string;
  /** Só em VALIDATION_FAILED e PASSWORD_POLICY: quais campos, nunca os valores. */
  readonly fields?: readonly string[];
}

/** As mensagens são em português: elas aparecem para o usuário (ADR 0023). */
export const AUTH_ERROR_MESSAGES: Record<AuthErrorCode, string> = {
  INVALID_CREDENTIALS: "E-mail ou senha incorretos",
  ACCOUNT_DEACTIVATED: "Esta conta está desativada",
  ACCESS_BLOCKED: "Muitas tentativas. Tente de novo mais tarde",
  CHALLENGE_INVALID: "Este acesso expirou. Entre de novo",
  INVALID_CODE: "Código incorreto",
  ACCESS_LINK_INVALID: "Este link não vale mais",
  PASSWORD_POLICY: "A senha não atende à política",
  VALIDATION_FAILED: "Dados inválidos",
  UNAUTHENTICATED: "Você precisa entrar",
  FORBIDDEN: "Você não tem permissão para esta ação",
  ROUTE_WITHOUT_POLICY: "Você não tem permissão para esta ação",
  RECENT_CONFIRMATION_REQUIRED: "Confirme sua identidade com o código do aplicativo",
  LAST_SUPER_ADMIN: "É preciso haver ao menos um super admin ativo",
  SELF_DEACTIVATION: "Você não pode desativar a si mesmo",
  CONNECTION_INVALID: "Esta autorização expirou ou não é sua. Comece de novo",
  ACCOUNT_NOT_PROFESSIONAL:
    "Esta conta do Instagram não é profissional. Mude para conta profissional no aplicativo e tente de novo",
  ACCOUNT_NOT_TESTER: "Esta conta ainda não aceitou o convite de testadora do PostIt",
  INSTAGRAM_UNAVAILABLE: "O Instagram não respondeu agora. Tente de novo em alguns minutos",
  ACCOUNT_ALREADY_CONNECTED: "Esta conta do Instagram já está conectada ao PostIt",
  INTERNAL_ERROR: "Algo deu errado",
};
