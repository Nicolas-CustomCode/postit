import {
  FEED_IMAGE_MAX_BYTES,
  FEED_IMAGE_MAX_RATIO,
  FEED_IMAGE_MIME,
  FEED_IMAGE_MIN_RATIO,
  FEED_IMAGE_MIN_WIDTH,
} from "@repo/shared";

/**
 * As regras de imagem de feed (RF-B02; docs/08, "Imagens — feed").
 *
 * Regra pura: sem Nest, sem Prisma, sem rede. Os limites vêm de
 * `packages/shared`, os mesmos que a tela usa para avisar antes do envio — aqui
 * é onde se decide de verdade (AGENTS.md, regra 17).
 */

/** O que impede esta imagem de virar uma postagem. `null` quando nada impede. */
export type ImageProblem =
  | "MEDIA_WRONG_TYPE"
  | "MEDIA_TOO_LARGE"
  | "MEDIA_TOO_NARROW"
  | "MEDIA_RATIO_UNSUPPORTED";

export interface ImageFacts {
  /** O tipo lido dos **bytes**, nunca o declarado pelo navegador. */
  readonly mimeType: string;
  readonly bytes: number;
  readonly width: number;
  readonly height: number;
}

/**
 * Largura e altura **como a imagem aparece**, aplicando a rotação do EXIF.
 *
 * ⚠️ **É a regra que mais importa aqui.** A câmera do celular grava o sensor
 * sempre na mesma orientação — 4032×3024, paisagem — e anota "gire 90°" num
 * campo do EXIF. A foto que a pessoa tirou em pé chega, nos bytes, deitada.
 *
 * O caso concreto: uma foto tirada em pé chega como 4032×3024 com orientação 6.
 * Sem girar, a proporção calculada é 1,33 — dentro da faixa, **aceita**. Girada,
 * a proporção real é 0,75, abaixo do mínimo de 4:5 — e tem de ser **recusada**,
 * com o aviso de recortar. Ou seja, sem esta correção o sistema aprova uma
 * imagem que o Instagram vai cortar sozinho, e a pessoa descobre depois de
 * publicada.
 *
 * O erro não apareceria em teste feito com imagem salva de editor: só com foto
 * tirada na hora, que é o que o roteiro da fase manda usar.
 *
 * As orientações 5, 6, 7 e 8 são as que envolvem quarto de volta; as outras
 * (1 a 4) são identidade ou espelhamento, e não mexem nas medidas.
 */
export function orientedSize(
  width: number,
  height: number,
  orientation?: number,
): { width: number; height: number } {
  const gira = orientation !== undefined && orientation >= 5 && orientation <= 8;
  return gira ? { width: height, height: width } : { width, height };
}

/**
 * Decide se a imagem serve para o feed.
 *
 * A ordem das conferências é a ordem em que elas ajudam quem enviou: tipo
 * primeiro, porque é o erro mais comum e o mais fácil de corrigir (docs/08 diz
 * que PNG é "a recusa mais comum no dia a dia"); proporção por último, porque é
 * a que exige editar a imagem.
 */
export function validateFeedImage(facts: ImageFacts): ImageProblem | null {
  if (facts.mimeType !== FEED_IMAGE_MIME) return "MEDIA_WRONG_TYPE";
  if (facts.bytes > FEED_IMAGE_MAX_BYTES) return "MEDIA_TOO_LARGE";
  if (facts.width < FEED_IMAGE_MIN_WIDTH) return "MEDIA_TOO_NARROW";
  if (!ratioAllowed(facts.width, facts.height)) return "MEDIA_RATIO_UNSUPPORTED";
  return null;
}

/**
 * A proporção cabe na faixa de 4:5 a 1.91:1?
 *
 * **Aritmética inteira, sem divisão.** Comparar `largura / altura` com `1.91`
 * traz a pergunta "1,9115 passa?", e a resposta passa a depender de
 * arredondamento de ponto flutuante. Multiplicando cruzado, 1080×1350 dá
 * exatamente o limite inferior e passa, sem ambiguidade nenhuma.
 *
 * Altura zero seria divisão por zero na forma ingênua; aqui vira `false`, que é
 * o que se quer de uma imagem sem altura.
 */
function ratioAllowed(width: number, height: number): boolean {
  if (height <= 0 || width <= 0) return false;

  // largura/altura >= 4/5   ⇔   largura * 5 >= altura * 4
  const acimaDoMinimo = width * FEED_IMAGE_MIN_RATIO.height >= height * FEED_IMAGE_MIN_RATIO.width;
  // largura/altura <= 191/100   ⇔   largura * 100 <= altura * 191
  const abaixoDoMaximo = width * FEED_IMAGE_MAX_RATIO.height <= height * FEED_IMAGE_MAX_RATIO.width;

  return acimaDoMinimo && abaixoDoMaximo;
}

/**
 * O tipo real do arquivo, lido dos **bytes**, não do que o navegador declarou.
 *
 * Quem envia controla o `Content-Type`, então ele não vale como prova — é o
 * mesmo princípio do `profile-photo.service.ts`, que confere o buffer e não o
 * cabeçalho.
 *
 * ⚠️ **`FF D8 FF` não basta.** O MPO — a foto 3D que algumas câmeras geram —
 * começa exatamente igual, e o docs/08 diz que *"extended JPEG formats such as
 * MPO and JPS are not supported"*. O que separa os dois é um segmento APP2 com
 * a marca `MPF`, procurado logo adiante.
 */
export function detectImageType(bytes: Buffer): string | null {
  if (bytes.length < 3) return null;
  if (!(bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff)) return null;
  if (hasMpfMarker(bytes)) return null;

  return FEED_IMAGE_MIME;
}

/** Procura o APP2 com `MPF\0` percorrendo os segmentos do começo do arquivo. */
function hasMpfMarker(bytes: Buffer): boolean {
  let i = 2;

  // Só o cabeçalho interessa: o MPF, quando existe, vem antes dos dados da
  // imagem. Parar no primeiro SOS evita varrer megabytes de pixel à toa.
  while (i + 4 <= bytes.length) {
    if (bytes[i] !== 0xff) return false;

    const marcador = bytes[i + 1];
    if (marcador === undefined || marcador === 0xda || marcador === 0xd9) return false;

    const tamanho = bytes.readUInt16BE(i + 2);
    if (tamanho < 2) return false;

    if (marcador === 0xe2 && bytes.subarray(i + 4, i + 8).toString("latin1") === "MPF\0") {
      return true;
    }

    i += 2 + tamanho;
  }

  return false;
}
