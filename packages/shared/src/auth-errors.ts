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
  "ACCOUNT_ACCESS_EXPIRED",
  "ACCOUNT_ALREADY_CONNECTED",
  // Envio e validação de mídia (ADR 0012; RF-B01, RF-B02).
  "MEDIA_WRONG_TYPE",
  "MEDIA_TOO_LARGE",
  "MEDIA_TOO_NARROW",
  "MEDIA_RATIO_UNSUPPORTED",
  "MEDIA_CORRUPT",
  "MEDIA_UPLOAD_INVALID",
  "MEDIA_ALREADY_CONFIRMED",
  // Composição da postagem (RF-C01, RF-C03, RF-C12; docs/05, máquina de estados).
  "POST_NOT_FOUND",
  "POST_VERSION_CONFLICT",
  "POST_TRANSITION_INVALID",
  "POST_NOT_EDITABLE",
  "POST_CAPTION_TOO_LONG",
  "POST_TOO_MANY_HASHTAGS",
  "POST_TOO_MANY_MENTIONS",
  "POST_MEDIA_REQUIRED",
  "SELF_APPROVAL_FORBIDDEN",
  "INTERNAL_ERROR",
] as const;

export type AuthErrorCode = (typeof AUTH_ERROR_CODES)[number];

/**
 * Quem salvou antes, e quando (RF-C12).
 *
 * Nome próprio porque atravessa três camadas — API, cliente e Server Action — e
 * um tipo anônimo repetido nas três divergiria na primeira mudança.
 */
export interface ActionConflict {
  readonly updatedByName: string | null;
  readonly updatedAt: string;
  /** A versão que está no banco agora — é dela que a próxima tentativa parte. */
  readonly version: number;
}

/** O corpo de erro que a API devolve. Nunca carrega token, código nem senha. */
export interface ApiErrorBody {
  readonly code: AuthErrorCode;
  readonly message: string;
  /** Só em ACCESS_BLOCKED: até quando o bloqueio vale, em ISO. */
  readonly blockedUntil?: string;
  /** Só em VALIDATION_FAILED e PASSWORD_POLICY: quais campos, nunca os valores. */
  readonly fields?: readonly string[];
  /**
   * Só em POST_VERSION_CONFLICT: quem salvou antes, e quando (RF-C12).
   *
   * Vai no corpo do erro em vez de a tela buscar depois porque a frase que o
   * docs/04 pede — "Esta postagem foi alterada por Fulano às 14h32" — precisa
   * aparecer **junto** com o aviso, não um instante depois. É o mesmo motivo de
   * `blockedUntil` existir: "tente mais tarde" sem dizer quando é o mesmo que
   * nada.
   */
  readonly conflict?: ActionConflict;
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
  ACCOUNT_ACCESS_EXPIRED: "A conexão com o Instagram expirou. Reconecte a conta",
  ACCOUNT_ALREADY_CONNECTED: "Esta conta do Instagram já está conectada ao PostIt",
  /*
   * Mídia: a mensagem diz **o limite**, e a tela acrescenta o valor do arquivo
   * quando o conhece — "JPEG de até 8 MB. Este arquivo tem 12,3 MB" (docs/04,
   * "Estados de interface"). Nunca "arquivo inválido": quem lê precisa saber
   * qual regra pegou e qual é o limite.
   */
  MEDIA_WRONG_TYPE: "O Instagram só aceita JPEG em imagens",
  MEDIA_TOO_LARGE: "A imagem passa do limite de 8 MB",
  MEDIA_TOO_NARROW: "A imagem é estreita demais: a largura mínima é 320 pixels",
  // Sem a faixa no texto: ela muda com o formato de destino (RF-B03), e quem
  // sabe qual formato está em jogo é a tela. Ela completa a frase.
  MEDIA_RATIO_UNSUPPORTED: "Proporção fora do permitido para este formato",
  MEDIA_CORRUPT: "Não consegui ler esta imagem. O arquivo pode estar corrompido",
  MEDIA_UPLOAD_INVALID: "Este envio não vale mais. Escolha o arquivo de novo",
  MEDIA_ALREADY_CONFIRMED: "Este arquivo já foi enviado",
  POST_NOT_FOUND: "Esta postagem não existe nesta conta",
  // A tela completa com quem alterou e quando, que vêm em `conflict`.
  POST_VERSION_CONFLICT: "Esta postagem foi alterada enquanto você editava",
  POST_TRANSITION_INVALID: "Esta postagem não pode mudar para esse estado agora",
  POST_NOT_EDITABLE: "Esta postagem não pode mais ser editada",
  POST_CAPTION_TOO_LONG: "A legenda passa de 2200 caracteres",
  POST_TOO_MANY_HASHTAGS: "A legenda passa de 30 hashtags",
  POST_TOO_MANY_MENTIONS: "A legenda passa de 20 menções",
  POST_MEDIA_REQUIRED: "Escolha uma imagem antes de marcar a postagem como pronta",
  SELF_APPROVAL_FORBIDDEN: "Você não pode aprovar a própria postagem",
  INTERNAL_ERROR: "Algo deu errado",
};
