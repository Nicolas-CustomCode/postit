import type { PostFormat, PostStatus } from "./domain";

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
}

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

/** Como cada formato aparece na tela. */
export const POST_FORMAT_LABELS: Record<PostFormat, string> = {
  FEED: "Feed",
  REELS: "Reels",
  STORIES: "Stories",
};
