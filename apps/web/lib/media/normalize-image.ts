import {
  imageKindProblem,
  normalizationPlan,
  sniffImageKind,
  type ConvertibleImageKind,
  type ImageKind,
  type NormalizeProblem,
  type NormalizeReason,
} from "@repo/shared";
import { blobToFile, loadImage, paraJpeg, type LoadedImage } from "@/lib/media/crop-image";

/**
 * Deixar o arquivo escolhido aceitável **antes** do envio (RF-B06, a parte das
 * imagens; ADR 0027): PNG, WebP e AVIF viram JPEG, e o JPEG pesado demais é
 * reduzido. A regra é `normalizationPlan`, em `packages/shared`; aqui só se
 * desenha.
 *
 * A API continua recusando o que não for JPEG de até 8 MB — é a última barreira,
 * e nada daqui a substitui (AGENTS.md, regra 10).
 */

/**
 * O que o seletor de arquivos oferece. HEIC fica de fora de propósito: no iPhone,
 * o Safari converte a foto da galeria para JPEG quando o `accept` não o lista.
 */
export const NORMALIZE_ACCEPT = "image/jpeg,image/png,image/webp,image/avif";

/** O que a confirmação conta à pessoa quando o arquivo que sobe não é o que ela escolheu. */
export interface NormalizeNotice {
  readonly from: ImageKind;
  readonly reasons: readonly NormalizeReason[];
  readonly original: { readonly width: number; readonly height: number };
  readonly final: { readonly width: number; readonly height: number };
}

export type NormalizedImage =
  | { readonly ok: true; readonly file: File; readonly image: LoadedImage; readonly notice: NormalizeNotice | null }
  | { readonly ok: false; readonly problem: NormalizeProblem };

export async function normalizeImage(file: File): Promise<NormalizedImage> {
  // O tipo pelos bytes, não pelo `file.type`: um PNG chamado `.jpg` também converte.
  const kind = sniffImageKind(new Uint8Array(await file.slice(0, 16).arrayBuffer()));
  const problemaDoTipo = imageKindProblem(kind);
  if (problemaDoTipo !== null) return { ok: false, problem: problemaDoTipo };
  // Sem problema de tipo, é um dos que o navegador converte.
  const convertivel = kind as ConvertibleImageKind;

  let original: LoadedImage;
  try {
    original = await loadImage(file);
  } catch {
    return { ok: false, problem: "UNREADABLE" };
  }

  const plano = normalizationPlan({
    kind: convertivel,
    bytes: file.size,
    width: original.width,
    height: original.height,
  });
  if (plano.action === "keep") return { ok: true, file, image: original, notice: null };

  try {
    if (plano.action === "refuse") return { ok: false, problem: plano.problem };

    const canvas = document.createElement("canvas");
    canvas.width = plano.width;
    canvas.height = plano.height;
    const ctx = canvas.getContext("2d");
    if (ctx === null) throw new Error("canvas indisponível");

    // Branco antes de desenhar: o JPEG não tem transparência, e o fundo
    // transparente de um PNG sairia preto.
    ctx.fillStyle = "#FFFFFF";
    ctx.fillRect(0, 0, plano.width, plano.height);
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(original.bitmap, 0, 0, plano.width, plano.height);

    const convertido = blobToFile(await paraJpeg(canvas), comExtensaoJpg(file.name));
    // Relido do arquivo novo: o resto do fluxo — prévia, proporção, ajuste — usa
    // só ele, que é o que sobe.
    const image = await loadImage(convertido);

    return {
      ok: true,
      file: convertido,
      image,
      notice: {
        from: convertivel,
        reasons: plano.reasons,
        original: { width: original.width, height: original.height },
        final: { width: image.width, height: image.height },
      },
    };
  } catch {
    return { ok: false, problem: "UNREADABLE" };
  } finally {
    // O original decodificado pode passar de 100 MB; no celular, isso pesa.
    original.bitmap.close();
  }
}

function comExtensaoJpg(nome: string): string {
  return `${nome.replace(/\.[^./\\]*$/, "")}.jpg`;
}
