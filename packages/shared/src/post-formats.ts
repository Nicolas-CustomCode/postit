import type { PostFormat } from "./domain";

/**
 * Quantas mídias cada formato aceita (docs/08, "Matriz de parâmetros por
 * formato" e "Carrossel"; ADR 0024).
 *
 * ⚠️ **Carrossel não é formato, é quantidade.** A Meta aceita imagens e vídeos
 * numa postagem só e monta o carrossel sozinha: `children` de 2 a 10 no
 * container pai, `is_carousel_item=true` nos filhos. Quem decide se a postagem
 * é carrossel é o número de linhas em `PostagemMidia`, não uma coluna.
 *
 * Este arquivo é separado de `media-formats.ts` de propósito: lá se decide o que
 * vale de **uma imagem** — bytes, pixels, proporção. Quantidade é outro eixo, e
 * misturar os dois faria a função de proporção precisar saber contar.
 *
 * Mora em `packages/shared` porque roda **nas duas pontas** (regra 6): a tela
 * apaga o botão de adicionar no décimo e recusa a troca de formato antes de
 * chamar; a API decide de verdade, em `postReadinessProblem()`.
 */
export const POST_MEDIA_COUNT: Record<PostFormat, { readonly min: number; readonly max: number }> = {
  // 1 = imagem simples; 2 a 10 = carrossel. Menos de 2 ou mais de 10 no
  // carrossel devolve o erro 2207028 da Meta, e este limite é o que o evita.
  FEED: { min: 1, max: 10 },
  // Reels não pode entrar em carrossel e Stories não tem `children` na matriz de
  // parâmetros (docs/08): os dois são sempre UMA mídia.
  REELS: { min: 1, max: 1 },
  STORIES: { min: 1, max: 1 },
};

/** O teto absoluto. Nenhum formato passa disso — é o que o schema zod limita. */
export const POST_MEDIA_MAX = 10;

export type MediaCountProblem = "POST_MEDIA_REQUIRED" | "POST_TOO_MANY_MEDIA" | "POST_FORMAT_SINGLE_MEDIA";

/** Quantas mídias este formato aceita? `null` quando a conta fecha. */
export function postMediaCountProblem(format: PostFormat, count: number): MediaCountProblem | null {
  const faixa = POST_MEDIA_COUNT[format];

  if (count < faixa.min) return "POST_MEDIA_REQUIRED";
  if (count <= faixa.max) return null;

  // Dois códigos, e não um genérico de "quantidade errada": "remova até sobrar
  // dez" e "este formato só aceita uma" pedem correções diferentes, e a pessoa
  // precisa saber qual das duas é a dela.
  return faixa.max === 1 ? "POST_FORMAT_SINGLE_MEDIA" : "POST_TOO_MANY_MEDIA";
}
