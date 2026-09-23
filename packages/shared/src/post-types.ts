import type { PostFormat, PostStatus } from "./domain";
import type { PublishFailureCause } from "./publish-failures";

/**
 * O que a API devolve sobre as postagens.
 *
 * Montado campo a campo, nunca o registro do Prisma (AGENTS.md, regra 6). Datas
 * como texto ISO **em UTC**: o que atravessa a fronteira é JSON, e a conversão
 * para o fuso da conta acontece na borda da tela (regra 7).
 */

/** Uma imagem dentro da postagem. `position` é a ordem no carrossel. */
export interface PostMediaItem {
  readonly mediaId: string;
  /** Endereço público, montado na leitura — nunca guardado no banco. */
  readonly url: string;
  readonly width: number;
  readonly height: number;
  readonly altText: string | null;
  readonly position: number;
}

/**
 * A linha da lista.
 *
 * ⚠️ **Traz `excerpt`, não a legenda inteira.** Uma legenda vai a 2200
 * caracteres; cinquenta delas numa lista são mais de 100 KB para mostrar três
 * linhas truncadas no celular.
 */
export interface PostSummary {
  readonly id: string;
  readonly format: PostFormat;
  readonly status: PostStatus;
  readonly excerpt: string | null;
  readonly thumbnailUrl: string | null;
  readonly scheduledAt: string | null;
  readonly updatedAt: string;
  /** Por que não saiu, ou por que está esperando — a lista destaca a falha com ela. */
  readonly failureCause: PublishFailureCause | null;
}

/** A postagem aberta na composição. */
export interface PostDetail {
  readonly id: string;
  readonly format: PostFormat;
  readonly status: PostStatus;
  readonly caption: string | null;
  /**
   * A versão que a tela carregou. Volta no salvamento e é o que faz a API
   * recusar com 409 quando outra pessoa salvou antes (RF-C12).
   */
  readonly version: number;
  readonly media: readonly PostMediaItem[];
  readonly scheduledAt: string | null;
  /**
   * Quem criou. A tela compara com quem está logado para esconder o botão de
   * aprovar quando falta `POST_APPROVE_OWN` — e a API confere de novo, porque
   * esconder não é proteger (regra 17).
   */
  readonly createdById: string;
  readonly createdByName: string;
  readonly updatedByName: string | null;
  readonly updatedAt: string;
  /**
   * Quando saiu e onde ver. Nulo enquanto não foi publicada. O `permalink` também
   * pode ser nulo com a postagem publicada: é a confirmada pelo estado do
   * container, sem que a Meta devolvesse o id da mídia (docs/08, V-28).
   */
  readonly publication: { readonly publishedAt: string; readonly permalink: string | null } | null;
  /**
   * A causa da última falha — ou da tentativa em andamento, em `PROCESSANDO`. Nula
   * quando não há. A frase vem de `PUBLISH_FAILURES`; o código cru da Meta nunca
   * chega aqui (RNF-07).
   */
  readonly failureCause: PublishFailureCause | null;
  /** Quantas execuções o publicador já fez neste ciclo: o "tentativa N de 5". */
  readonly attempts: number;
  /** A conta perdeu o acesso: a tela oferece reconectar (docs/09, "sinaliza a conta"). */
  readonly accountAccessLost: boolean;
}

/**
 * Uma linha do histórico da publicação (RF-F09): o que o motor fez, quando e
 * como terminou. `detail` é a resposta da Meta **já saneada** no cliente — sem
 * token (AGENTS.md, regra 3) —, para quem investiga; a tela o mostra recolhido.
 */
export interface PostHistoryEntry {
  readonly at: string;
  readonly step: "CREATE_CONTAINER" | "CHECK_STATUS" | "PUBLISH" | "COLLECT_METRICS" | "DISPATCH" | "RECONCILE" | "GIVE_UP";
  readonly result: "SUCCESS" | "RECOVERABLE_ERROR" | "FATAL_ERROR";
  readonly detail: unknown;
}

/**
 * O que uma decisão humana de estado registrou em `Aprovacao` (ADR 0026). Os
 * nomes são os do enum `AcaoAprovacao` do banco, traduzidos pelo ADR 0023.
 */
export type PostTrailAction =
  | "SUBMITTED_FOR_REVIEW"
  | "APPROVED"
  | "REJECTED"
  | "INVALIDATED_BY_EDIT"
  | "RETURNED_TO_DRAFT"
  | "SCHEDULED"
  | "UNSCHEDULED"
  | "CANCELED";

/**
 * Uma linha da linha do tempo da Revisão: comentários e histórico juntos, em ordem,
 * para cada comentário ter o seu contexto (ADR 0026, decisão 5).
 *
 * ⚠️ **Só nomes, nunca e-mail, e nada da resposta da Meta** (AGENTS.md, regra 3):
 * quem só vê também lê esta lista. O detalhe técnico fica no histórico da falha.
 */
export type PostTimelineEntry =
  | { readonly kind: "CREATED"; readonly id: string; readonly at: string; readonly byName: string }
  | {
      readonly kind: "DECISION";
      readonly id: string;
      readonly at: string;
      readonly byName: string;
      readonly action: PostTrailAction;
      readonly reason: string | null;
      readonly scheduledFor: string | null;
    }
  | { readonly kind: "COMMENT"; readonly id: string; readonly at: string; readonly byName: string; readonly text: string }
  | {
      readonly kind: "PUBLISHING";
      readonly id: string;
      readonly at: string;
      readonly outcome: "PUBLISHED" | "FAILED" | "RETRYING";
      readonly cause: PublishFailureCause | null;
    };

/** Quantos caracteres da legenda vão no `excerpt` da lista. */
export const POST_EXCERPT_LENGTH = 140;

/** Como cada estado aparece na tela (ADR 0023: texto para o usuário em pt-BR). */
export const POST_STATUS_LABELS: Record<PostStatus, string> = {
  DRAFT: "Rascunho",
  IN_REVIEW: "Em revisão",
  APPROVED: "Pronta",
  SCHEDULED: "Agendada",
  PROCESSING: "Publicando",
  PUBLISHED: "Publicada",
  FAILED: "Falhou",
  CANCELED: "Descartada",
};

/**
 * Os estados em que a postagem **não se edita mais**: saiu, está saindo ou foi
 * descartada. A tela os abre só para ver, e a API recusa qualquer escrita neles —
 * as duas leem esta lista, para não divergirem.
 *
 * `FALHOU` não está aqui de propósito: ela espera a pessoa decidir — reagendar,
 * voltar para rascunho ou cancelar (ADR 0007).
 */
export const POST_READ_ONLY_STATUSES: readonly PostStatus[] = ["PROCESSING", "PUBLISHED", "CANCELED"];

export function isPostEditable(status: PostStatus): boolean {
  return !POST_READ_ONLY_STATUSES.includes(status);
}

/** Como cada formato aparece na tela. */
export const POST_FORMAT_LABELS: Record<PostFormat, string> = {
  FEED: "Feed",
  REELS: "Reels",
  STORIES: "Stories",
};
