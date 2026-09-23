import { COMPOSABLE_FORMATS, type ComposableFormat, type MediaSummary, type PostDetail } from "@repo/shared";

/**
 * O que a `FeedPreview` precisa, a partir de uma postagem já salva — nas telas
 * que só mostram (leitura e falha), onde não há acervo carregado.
 */

/** A prévia só conhece os formatos que se compõem; Reels (Fase 2) cai no feed. */
export function previewFormat(post: Pick<PostDetail, "format">): ComposableFormat {
  return (COMPOSABLE_FORMATS as readonly string[]).includes(post.format) ? (post.format as ComposableFormat) : "FEED";
}

/** As imagens anexadas, no formato que a prévia desenha, na ordem da postagem. */
export function previewMedia(post: Pick<PostDetail, "media">): MediaSummary[] {
  return post.media.map((item) => ({
    id: item.mediaId,
    url: item.url,
    width: item.width,
    height: item.height,
    bytes: 0,
    createdAt: "",
    // Está anexada a esta postagem, por definição.
    inUse: true,
  }));
}
