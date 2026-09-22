import { cropRect, type CropPosition, type FitLayout } from "@repo/shared";

/**
 * Ler e recortar a imagem no navegador (RF-B02).
 *
 * **Por que no navegador e não na API.** Três razões: o arquivo que sai é
 * exatamente o que a pessoa viu na prévia; a API não precisa de biblioteca de
 * processamento de imagem, que seria a maior dependência do projeto; e o
 * navegador **já aplica a orientação EXIF** ao decodificar, então a foto deitada
 * some na origem em vez de virar um caso especial.
 */

/** A imagem já decodificada e com a orientação aplicada. */
export interface LoadedImage {
  readonly bitmap: ImageBitmap;
  readonly width: number;
  readonly height: number;
}

/**
 * Decodifica o arquivo, respeitando a orientação gravada pela câmera.
 *
 * `imageOrientation: "from-image"` é explícito de propósito: é o padrão da
 * especificação, mas deixar implícito esconderia justamente a linha que faz a
 * foto de celular chegar em pé.
 */
export async function loadImage(file: File): Promise<LoadedImage> {
  const bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
  return { bitmap, width: bitmap.width, height: bitmap.height };
}

/**
 * A mesma imagem, vinda do acervo em vez de um arquivo escolhido.
 *
 * ⚠️ **`fetch`, e não `<img crossOrigin>`.** Sem o cabeçalho de CORS, o `fetch`
 * rejeita **antes** de qualquer pixel ser desenhado e dá para explicar o que
 * houve. Com `<img>` sem `crossOrigin`, o canvas fica contaminado em silêncio e
 * o erro só aparece no `toBlob` — depois de a pessoa já ter escolhido o
 * enquadramento, que é o pior momento possível.
 *
 * A decodificação é a mesma de `loadImage`, com a mesma opção de orientação: as
 * medidas daqui batem com as que a API gravou em `Midia`.
 */
export async function loadImageFromUrl(url: string): Promise<LoadedImage> {
  const resposta = await fetch(url, { mode: "cors", credentials: "omit" });
  if (!resposta.ok) throw new Error(`o armazenamento respondeu ${resposta.status}`);

  const bitmap = await createImageBitmap(await resposta.blob(), { imageOrientation: "from-image" });
  return { bitmap, width: bitmap.width, height: bitmap.height };
}

/**
 * Recorta na proporção pedida e devolve um JPEG novo.
 *
 * A qualidade fica em 0,92: acima disso o arquivo cresce sem diferença visível,
 * e abaixo aparece artefato em foto com céu ou pele. O limite de 8 MB continua
 * valendo, e o recorte quase sempre deixa o arquivo menor que o original.
 */
export async function cropToJpeg(
  image: LoadedImage,
  ratio: number,
  position: CropPosition,
): Promise<Blob> {
  const rect = cropRect(image.width, image.height, ratio, position);

  const canvas = document.createElement("canvas");
  canvas.width = rect.width;
  canvas.height = rect.height;

  const ctx = canvas.getContext("2d");
  if (ctx === null) throw new Error("canvas indisponível");

  ctx.drawImage(image.bitmap, rect.x, rect.y, rect.width, rect.height, 0, 0, rect.width, rect.height);

  return paraJpeg(canvas);
}

/**
 * A imagem inteira dentro da moldura, com o resto pintado de branco.
 *
 * ⚠️ **Branco fixo, e não cor de tema.** Este arquivo vai para o Instagram: o
 * tema do aparelho de quem publica não tem nada a ver com o resultado. Sem
 * desfoque também — o docs/13 proíbe efeito, e `ctx.filter` tem suporte
 * irregular no Safari, que é onde o PWA precisa rodar.
 */
export async function fitToJpeg(image: LoadedImage, layout: FitLayout): Promise<Blob> {
  const canvas = document.createElement("canvas");
  canvas.width = layout.width;
  canvas.height = layout.height;

  const ctx = canvas.getContext("2d");
  if (ctx === null) throw new Error("canvas indisponível");

  ctx.fillStyle = "#FFFFFF";
  ctx.fillRect(0, 0, layout.width, layout.height);

  const { x, y, width, height } = layout.image;
  ctx.drawImage(image.bitmap, 0, 0, image.width, image.height, x, y, width, height);

  return paraJpeg(canvas);
}

/** O recorte vira `File` porque é isso que o envio espera. */
export function blobToFile(blob: Blob, name: string): File {
  return new File([blob], name, { type: "image/jpeg" });
}

function paraJpeg(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolver, rejeitar) => {
    canvas.toBlob(
      (blob) => (blob === null ? rejeitar(new Error("não consegui gerar a imagem")) : resolver(blob)),
      "image/jpeg",
      0.92,
    );
  });
}
