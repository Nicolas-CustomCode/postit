import { IMAGE_MAX_BYTES } from "./media-formats";

/**
 * Converter e reduzir a imagem **antes** do envio (RF-B06, a parte das imagens;
 * ADR 0027).
 *
 * A Meta só aceita JPEG de até 8 MB, e a API continua recusando o resto — ela é a
 * última barreira. Esta regra decide o que a tela faz com o arquivo escolhido
 * para ele chegar lá aceitável: nada, recodificar, ou recusar com o motivo certo.
 *
 * Pura, sem canvas: quem desenha é `apps/web/lib/media/normalize-image.ts`.
 */

export type ImageKind = "jpeg" | "png" | "webp" | "avif" | "heic" | "gif";

/** O que a tela sabe transformar em JPEG com o próprio navegador. */
export type ConvertibleImageKind = "jpeg" | "png" | "webp" | "avif";

/**
 * O lado maior de uma imagem **recodificada**. A Meta publica até 1440 px de
 * largura e reduz sozinha acima disso (docs/08); o que sobra é folga para recortar
 * depois sem cair abaixo dos 1440. Em qualidade 0.92, dá 1 a 3 MB.
 */
export const NORMALIZE_MAX_SIDE = 2160;

/**
 * Tetos do que a tela aceita **abrir**. Decodificar uma imagem é largura × altura
 * × 4 bytes de memória: 50 megapixels já são 200 MB, e no celular a aba cai antes
 * de a pessoa ver qualquer mensagem.
 */
export const NORMALIZE_MAX_INPUT_BYTES = 50_000_000;
export const NORMALIZE_MAX_PIXELS = 50_000_000;

export type NormalizeReason = "CONVERTED" | "REDUCED";
export type NormalizeProblem = "UNREADABLE" | "HEIC" | "GIF" | "TOO_BIG_TO_CONVERT";

export type NormalizationPlan =
  | { readonly action: "keep" }
  | {
      readonly action: "reencode";
      readonly reasons: readonly NormalizeReason[];
      readonly width: number;
      readonly height: number;
    }
  | { readonly action: "refuse"; readonly problem: NormalizeProblem };

/**
 * O tipo pela **assinatura** dos primeiros bytes, nunca pelo `file.type` nem pela
 * extensão: um PNG chamado `foto.jpg` chega como `image/jpeg` e seria recusado só
 * pela API, depois do envio. Bastam 16 bytes.
 */
export function sniffImageKind(bytes: Uint8Array): ImageKind | null {
  const ascii = (inicio: number, fim: number) => String.fromCharCode(...bytes.subarray(inicio, fim));

  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "jpeg";
  if (bytes.length >= 8 && [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a].every((b, i) => bytes[i] === b)) {
    return "png";
  }
  if (bytes.length >= 4 && ascii(0, 4) === "GIF8") return "gif";
  if (bytes.length >= 12 && ascii(0, 4) === "RIFF" && ascii(8, 12) === "WEBP") return "webp";
  // AVIF e HEIC são a mesma caixa `ftyp` (ISO BMFF); o que difere é a marca.
  if (bytes.length >= 12 && ascii(4, 8) === "ftyp") {
    const marca = ascii(8, 12);
    if (marca === "avif" || marca === "avis") return "avif";
    if (["heic", "heix", "hevc", "hevx", "heim", "heis", "mif1", "msf1"].includes(marca)) return "heic";
  }
  return null;
}

/**
 * O tipo que não dá para converter, **antes** de decodificar.
 *
 * HEIC fica fora porque só o Safari o decodifica — e no iPhone o próprio Safari
 * já entrega JPEG ao escolher da galeria. GIF, porque o Instagram perderia a
 * animação e publicaria só o primeiro quadro sem avisar ninguém.
 */
export function imageKindProblem(kind: ImageKind | null): NormalizeProblem | null {
  if (kind === null) return "UNREADABLE";
  if (kind === "heic") return "HEIC";
  if (kind === "gif") return "GIF";
  return null;
}

/**
 * O que fazer com uma imagem já decodificada.
 *
 * **JPEG de até 8 MB fica intocado**, qualquer que seja o tamanho em pixels:
 * recodificar sem necessidade só perde qualidade, e a Meta reduz sozinha.
 */
export function normalizationPlan(image: {
  kind: ConvertibleImageKind;
  bytes: number;
  width: number;
  height: number;
}): NormalizationPlan {
  const { kind, bytes, width, height } = image;
  if (kind === "jpeg" && bytes <= IMAGE_MAX_BYTES) return { action: "keep" };
  if (width * height > NORMALIZE_MAX_PIXELS) return { action: "refuse", problem: "TOO_BIG_TO_CONVERT" };

  const escala = Math.min(1, NORMALIZE_MAX_SIDE / Math.max(width, height));
  const final = {
    width: Math.max(1, Math.round(width * escala)),
    height: Math.max(1, Math.round(height * escala)),
  };

  const reasons: NormalizeReason[] = [];
  if (kind !== "jpeg") reasons.push("CONVERTED");
  // JPEG acima de 8 MB está aqui por causa do peso: mesmo sem mudar de tamanho, é
  // redução — a qualidade 0.92 é o que o traz para baixo do limite.
  if (escala < 1 || kind === "jpeg") reasons.push("REDUCED");

  return { action: "reencode", reasons, ...final };
}
