/**
 * Os limites da legenda (RF-C03; docs/08, "Detalhes que a tabela não comporta").
 *
 * A Meta diz, textualmente: *"Maximum 2200 characters, 30 hashtags, and 20 @
 * tags."* Os três viram contador na tela e recusa na API — e saem **da mesma
 * função**, que é o motivo de morarem aqui. Um contador que discordasse da
 * validação deixaria a pessoa escrever até o verde e ouvir "não" ao salvar.
 *
 * Puro: sem Nest, sem navegador, sem banco.
 */

export const CAPTION_MAX_LENGTH = 2200;
export const CAPTION_MAX_HASHTAGS = 30;
export const CAPTION_MAX_MENTIONS = 20;

/**
 * ⚠️ **A Meta não diz como conta "caractere".** Emoji, acento combinado e
 * bandeira têm contagens diferentes em code points, unidades UTF-16 e grafemas.
 * Usamos `length` — unidades UTF-16 —, que é a **maior** das três: um emoji
 * conta 2. Errar para o lado que recusa cedo custa uma frase reescrita; errar
 * para o outro custa uma publicação que falha sozinha de madrugada.
 */
function captionLength(caption: string): number {
  return caption.length;
}

/**
 * Hashtags e menções são contadas por expressão regular, com uma regra: o `#` ou
 * o `@` precisa **começar palavra**.
 *
 * Sem isso, `contato@empresa.com` viraria uma menção e a pessoa levaria uma
 * recusa incompreensível ao escrever um e-mail na legenda. O `(?<!…)` é o que
 * exige que antes do símbolo não venha letra, número ou sublinhado.
 *
 * O caso `#um#dois` conta **1**, não 2 — o segundo `#` vem grudado numa letra.
 * É a diferença conhecida entre esta contagem e a do Instagram, e ela erra para
 * menos num caso raro; quem escreve 30 hashtags não as escreve grudadas.
 */
const HASHTAG = /(?<![\p{L}\p{N}_])#[\p{L}\p{N}_]+/gu;
const MENTION = /(?<![\p{L}\p{N}_.])@[a-zA-Z0-9_.]+/gu;

export interface CaptionCounts {
  readonly length: number;
  readonly hashtags: number;
  readonly mentions: number;
}

/** Os três números que a tela mostra enquanto a pessoa digita. */
export function captionCounts(caption: string): CaptionCounts {
  return {
    length: captionLength(caption),
    hashtags: caption.match(HASHTAG)?.length ?? 0,
    mentions: caption.match(MENTION)?.length ?? 0,
  };
}

export type CaptionProblem = "POST_CAPTION_TOO_LONG" | "POST_TOO_MANY_HASHTAGS" | "POST_TOO_MANY_MENTIONS";

/** O que impede esta legenda de virar postagem. `null` quando nada impede. */
export function captionProblem(caption: string): CaptionProblem | null {
  const contagem = captionCounts(caption);

  if (contagem.length > CAPTION_MAX_LENGTH) return "POST_CAPTION_TOO_LONG";
  if (contagem.hashtags > CAPTION_MAX_HASHTAGS) return "POST_TOO_MANY_HASHTAGS";
  if (contagem.mentions > CAPTION_MAX_MENTIONS) return "POST_TOO_MANY_MENTIONS";
  return null;
}
