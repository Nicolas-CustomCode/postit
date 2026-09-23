/**
 * Por que uma publicação não saiu — ou ainda não saiu — e o que fazer.
 *
 * `Postagem.ultimoErroCodigo` guarda a **causa**, não o código da Meta: o código
 * cru vive em `EventoPublicacao.respostaMeta`, para quem investiga (RF-F09), e a
 * tela mostra a frase daqui (RNF-07: todo erro em português, dizendo o que fazer).
 *
 * As frases seguem a tabela de códigos do docs/08, adaptadas para quem vai ler
 * sem saber o que é um container.
 *
 * ⚠️ **As causas passageiras dizem só o que aconteceu, nunca "o sistema tenta de
 * novo".** A mesma causa fica gravada quando as tentativas se esgotam e a postagem
 * vai para `FALHOU` — e aí a frase mentiria. O próximo passo quem diz é a tela,
 * pelo estado: em `PROCESSANDO`, que vem nova tentativa; em `FALHOU`, a `action`.
 */
export const PUBLISH_FAILURE_CAUSES = [
  // Antes de começar — o despachante
  "SYSTEM_UNAVAILABLE",
  "QUOTA_DEFERRED",
  "QUOTA_EXCEEDED",
  // A conta
  "TOKEN_INVALID",
  "TOKEN_UNREADABLE",
  "PERMISSION_MISSING",
  "ACCOUNT_RESTRICTED",
  // A mídia e a postagem
  "MEDIA_DOWNLOAD_FAILED",
  "MEDIA_REJECTED",
  "CAROUSEL_COUNT",
  // O preparo na Meta
  "CONTAINER_NOT_READY",
  "CONTAINER_CREATE_FAILED",
  "CONTAINER_ERROR",
  "CONTAINER_EXPIRED",
  // Passageiros
  "RATE_LIMITED",
  "META_UNSTABLE",
  "NETWORK",
  // O fim da linha
  "LATE_CEILING",
  "PUBLISH_UNCERTAIN",
  "META_REFUSED",
] as const;

export type PublishFailureCause = (typeof PUBLISH_FAILURE_CAUSES)[number];

/**
 * Quantas execuções o publicador faz antes de desistir: a original e as 4
 * repetições da fila (docs/09, "Retentativa"). A tela mostra "tentativa N de 5";
 * o publicador para na sexta.
 */
export const PUBLISH_MAX_ATTEMPTS = 5;

/**
 * O que a tela oferece como próximo passo (ADR 0007: reagendar, corrigir ou
 * cancelar — cancelar vale sempre, por isso não aparece aqui).
 */
export type PublishFailureAction = "RESCHEDULE" | "FIX" | "RECONNECT" | "CHECK_PROFILE";

export interface PublishFailureInfo {
  readonly message: string;
  readonly action: PublishFailureAction;
}

export const PUBLISH_FAILURES: Record<PublishFailureCause, PublishFailureInfo> = {
  SYSTEM_UNAVAILABLE: {
    message: "O sistema estava indisponível no horário marcado, e a postagem não saiu. Escolha um novo horário.",
    action: "RESCHEDULE",
  },
  QUOTA_DEFERRED: {
    message:
      "A conta chegou ao limite de publicações das últimas 24 horas. A postagem sai assim que houver espaço, se for em até 15 minutos.",
    action: "RESCHEDULE",
  },
  QUOTA_EXCEEDED: {
    message: "A conta atingiu o limite de publicações das últimas 24 horas. Escolha um horário mais adiante.",
    action: "RESCHEDULE",
  },
  TOKEN_INVALID: {
    message: "A conexão com o Instagram expirou ou foi revogada. Reconecte a conta e reagende.",
    action: "RECONNECT",
  },
  TOKEN_UNREADABLE: {
    message: "Não foi possível usar a conexão guardada desta conta. Reconecte a conta e reagende.",
    action: "RECONNECT",
  },
  PERMISSION_MISSING: {
    message: "O aplicativo não tem permissão para publicar nesta conta. Reconecte a conta e aceite todas as permissões.",
    action: "RECONNECT",
  },
  ACCOUNT_RESTRICTED: {
    message: "A conta está com restrição no Instagram. Verifique no aplicativo do Instagram antes de reagendar.",
    action: "RESCHEDULE",
  },
  MEDIA_DOWNLOAD_FAILED: {
    message: "O Instagram não conseguiu baixar a imagem. Tente reagendar; se repetir, troque a imagem.",
    action: "RESCHEDULE",
  },
  MEDIA_REJECTED: {
    message: "O Instagram recusou a imagem para este formato. Troque ou ajuste a imagem.",
    action: "FIX",
  },
  CAROUSEL_COUNT: {
    message: "O carrossel precisa ter de 2 a 10 imagens. Corrija a postagem.",
    action: "FIX",
  },
  CONTAINER_NOT_READY: {
    message: "O Instagram demorou demais para preparar a imagem.",
    action: "RESCHEDULE",
  },
  CONTAINER_CREATE_FAILED: {
    message: "Não foi possível preparar a publicação no Instagram.",
    action: "RESCHEDULE",
  },
  CONTAINER_ERROR: {
    message: "O Instagram não conseguiu processar a imagem. Tente reagendar; se repetir, troque a imagem.",
    action: "RESCHEDULE",
  },
  CONTAINER_EXPIRED: {
    message: "O preparo da publicação no Instagram expirou. Escolha um novo horário.",
    action: "RESCHEDULE",
  },
  RATE_LIMITED: {
    message: "O Instagram recusou por excesso de requisições.",
    action: "RESCHEDULE",
  },
  META_UNSTABLE: {
    message: "O Instagram está instável.",
    action: "RESCHEDULE",
  },
  NETWORK: {
    message: "Não foi possível falar com o Instagram.",
    action: "RESCHEDULE",
  },
  LATE_CEILING: {
    message:
      "O Instagram não aceitou a publicação a tempo, e ela passaria de 45 minutos de atraso. Escolha um novo horário.",
    action: "RESCHEDULE",
  },
  PUBLISH_UNCERTAIN: {
    message:
      "Não foi possível confirmar se a publicação saiu. Confira o perfil no Instagram antes de reagendar, para não publicar duas vezes.",
    action: "CHECK_PROFILE",
  },
  META_REFUSED: {
    message: "O Instagram recusou a publicação. Confira a postagem e reagende.",
    action: "FIX",
  },
};

export function isPublishFailureCause(value: string | null | undefined): value is PublishFailureCause {
  return (PUBLISH_FAILURE_CAUSES as readonly string[]).includes(value ?? "");
}
