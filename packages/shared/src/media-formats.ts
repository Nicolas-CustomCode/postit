import type { PostFormat } from "./domain";

/**
 * O que cada formato de postagem aceita como imagem (docs/08, "Especificações de
 * mídia"; RF-B02 e RF-B03).
 *
 * **O ponto que dá sentido a este arquivo:** a faixa apertada de proporção —
 * 4:5 a 1.91:1 — vale **só para o feed**. Stories não tem faixa obrigatória, e
 * os vídeos aceitam de 0.01:1 a 10:1. Validar tudo contra o feed, como o envio
 * fazia até 18/09/2026, recusava uma arte 9:16 legítima de Stories e a recortava
 * para 4:5 — destruindo justamente o formato que a pessoa queria.
 *
 * Por isso o envio valida só **o piso comum** (`IMAGE_UPLOAD_SPEC`) e a decisão
 * "esta imagem serve?" acontece onde o formato é conhecido: na composição
 * (RF-B03). A mídia guarda fatos — largura, altura, bytes —, nunca a intenção de
 * uso; é o que permite a mesma imagem servir a mais de uma postagem (RF-B04) e o
 * que o modelo `Midia` do banco já assumia.
 *
 * Mora em `packages/shared` porque roda **nas duas pontas**: a tela informa para
 * que formatos a imagem serve, a API decide de verdade (AGENTS.md, regra 17).
 * Duas cópias que discordassem fariam a tela mentir.
 */

export interface Ratio {
  readonly width: number;
  readonly height: number;
}

export interface ImageSpec {
  /** Como o formato aparece para quem lê a mensagem. */
  readonly label: string;
  readonly mime: string;
  readonly maxBytes: number;
  readonly minWidth: number;
  /** `null` quando a Meta não documenta faixa obrigatória — o caso de Stories. */
  readonly ratio: { readonly min: Ratio; readonly max: Ratio } | null;
  readonly ratioLabel: string | null;
}

/**
 * Os formatos que aceitam **imagem**. `REELS` fica de fora: é vídeo, que entra
 * na Fase 2 com especificações próprias (codec, duração, átomo `moov`).
 */
export const IMAGE_FORMATS = ["FEED", "STORIES"] as const;
export type ImageFormat = (typeof IMAGE_FORMATS)[number];

/**
 * Só JPEG, em qualquer formato — a API recusa PNG, WebP, HEIC e AVIF (docs/08).
 * A tela converte PNG, WebP e AVIF antes de enviar (RF-B06, `image-normalize.ts`).
 */
export const IMAGE_MIME = "image/jpeg";

/**
 * O limite de 8 MB da Meta, em bytes — o mesmo para imagem de feed e de Stories.
 *
 * ⚠️ **Decimal, e é uma escolha conservadora.** A documentação da Meta diz "8MB"
 * sem dizer a base; 8 MiB seriam 8.388.608. Aceitar o valor maior deixaria passar
 * um arquivo que ela recusaria **na hora de publicar** — e o docs/08 diz que erro
 * de mídia não deveria chegar lá.
 */
export const IMAGE_MAX_BYTES = 8_000_000;

/**
 * Largura mínima, aplicada a **toda** imagem.
 *
 * ⚠️ **Documentada só para o feed.** A Meta não publica mínimo para Stories, mas
 * uma imagem de 100 px não serve para nada na prática — é prudência nossa, não
 * fonte, e está registrada no docs/08 com a data.
 *
 * Não há **máximo**: a Meta lista 1440 px mas não devolve erro para largura, e
 * recusar barraria quase toda foto de celular, que passa de 3000 px.
 */
export const IMAGE_MIN_WIDTH = 320;

export const IMAGE_SPECS: Record<ImageFormat, ImageSpec> = {
  // Uma entrada só, e ela vale também para **item de carrossel**: a Meta usa a
  // mesma tabela nos dois (docs/08, "Imagens — feed e itens de carrossel"). Eram
  // duas entradas idênticas enquanto carrossel era formato (ADR 0024).
  FEED: {
    label: "Feed",
    mime: IMAGE_MIME,
    maxBytes: IMAGE_MAX_BYTES,
    minWidth: IMAGE_MIN_WIDTH,
    ratio: { min: { width: 4, height: 5 }, max: { width: 191, height: 100 } },
    ratioLabel: "4:5 a 1.91:1",
  },
  // "JPEG, até 8 MB, sRGB, 9:16 recomendado" — e só. **Recomendado não é
  // obrigatório**, e a Meta não publica faixa para imagem de Stories, então não
  // há o que validar aqui sem inventar limite (docs/08, "A validar").
  STORIES: {
    label: "Stories",
    mime: IMAGE_MIME,
    maxBytes: IMAGE_MAX_BYTES,
    minWidth: IMAGE_MIN_WIDTH,
    ratio: null,
    ratioLabel: null,
  },
};

/**
 * O piso do envio: o que reprova em **qualquer** formato.
 *
 * Note a ausência de proporção. Não existe faixa comum — a do feed é apertada, a
 * de Stories não existe —, então exigir uma aqui seria escolher um formato às
 * escondidas, que é exatamente o defeito que este arquivo corrige.
 */
export const IMAGE_UPLOAD_SPEC = {
  mime: IMAGE_MIME,
  maxBytes: IMAGE_MAX_BYTES,
  minWidth: IMAGE_MIN_WIDTH,
} as const;

/** O que impede esta imagem de ser aceita. `null` quando nada impede. */
export type ImageProblem = "MEDIA_WRONG_TYPE" | "MEDIA_TOO_LARGE" | "MEDIA_TOO_NARROW" | "MEDIA_RATIO_UNSUPPORTED";

export interface ImageFacts {
  /** O tipo lido dos **bytes**, nunca o declarado por quem enviou. */
  readonly mimeType: string;
  readonly bytes: number;
  /** Já com a rotação do EXIF aplicada — a foto em pé chega deitada nos bytes. */
  readonly width: number;
  readonly height: number;
}

/**
 * A proporção cabe na faixa do formato? Sem faixa, tudo cabe.
 *
 * **Aritmética inteira, sem divisão.** Comparar `largura / altura` com `1.91`
 * traz a pergunta "1,9115 passa?", e a resposta passa a depender de
 * arredondamento de ponto flutuante. Multiplicando cruzado, 1080×1350 dá
 * exatamente o limite inferior e passa, sem ambiguidade nenhuma.
 *
 * Altura zero seria divisão por zero na forma ingênua; aqui vira `false`, que é
 * o que se quer de uma imagem sem altura.
 */
export function ratioFits(width: number, height: number, spec: ImageSpec): boolean {
  if (height <= 0 || width <= 0) return false;
  if (spec.ratio === null) return true;

  // largura/altura >= min.w/min.h   ⇔   largura * min.h >= altura * min.w
  const acimaDoMinimo = width * spec.ratio.min.height >= height * spec.ratio.min.width;
  // largura/altura <= max.w/max.h   ⇔   largura * max.h <= altura * max.w
  const abaixoDoMaximo = width * spec.ratio.max.height <= height * spec.ratio.max.width;

  return acimaDoMinimo && abaixoDoMaximo;
}

/**
 * Decide se a imagem pode **entrar no acervo** (RF-B02).
 *
 * A ordem das conferências é a ordem em que elas ajudam quem enviou: tipo
 * primeiro, porque é o erro mais comum e o mais fácil de corrigir (docs/08 diz
 * que PNG é "a recusa mais comum no dia a dia").
 *
 * **Não olha proporção** — essa pergunta só faz sentido com um formato em mãos,
 * e é `validateImageFormat()` quem a responde.
 *
 * Medida degenerada (altura zero) não é problema desta função: quem lê os bytes
 * trata isso como arquivo corrompido, que é o que ele é.
 */
export function validateImageUpload(facts: ImageFacts): ImageProblem | null {
  if (facts.mimeType !== IMAGE_UPLOAD_SPEC.mime) return "MEDIA_WRONG_TYPE";
  if (facts.bytes > IMAGE_UPLOAD_SPEC.maxBytes) return "MEDIA_TOO_LARGE";
  if (facts.width < IMAGE_UPLOAD_SPEC.minWidth) return "MEDIA_TOO_NARROW";
  return null;
}

/** Decide se a imagem serve para **um formato**, na hora de compor (RF-B03). */
export function validateImageFormat(facts: ImageFacts, format: ImageFormat): ImageProblem | null {
  const problemaDeBase = validateImageUpload(facts);
  if (problemaDeBase !== null) return problemaDeBase;

  return ratioFits(facts.width, facts.height, IMAGE_SPECS[format]) ? null : "MEDIA_RATIO_UNSUPPORTED";
}

/**
 * Para que formatos esta imagem serve, só pelas medidas.
 *
 * É o que a tela de envio usa para dizer "esta serve para Stories, não para o
 * feed" em vez de recortar sozinha, e o que o seletor de mídia da composição usa
 * para filtrar o que mostra.
 */
export function formatsFor(width: number, height: number): readonly ImageFormat[] {
  return IMAGE_FORMATS.filter((formato) => ratioFits(width, height, IMAGE_SPECS[formato]));
}

/** Um formato de postagem aceita imagem? Descarta `REELS`, que é vídeo. */
export function isImageFormat(format: PostFormat): format is ImageFormat {
  return (IMAGE_FORMATS as readonly PostFormat[]).includes(format);
}
