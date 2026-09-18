import { IMAGE_MIME } from "@repo/shared";

/**
 * O que só os **bytes** do arquivo revelam (RF-B02; docs/08).
 *
 * As especificações — o que cada formato aceita de tipo, tamanho e proporção —
 * ficam em `packages/shared`, porque a tela também precisa delas. Aqui mora o que
 * exige o buffer em mãos: reconhecer o formato pela assinatura e ler a rotação da
 * câmera.
 *
 * Regra pura: sem Nest, sem Prisma, sem rede.
 */

/**
 * Largura e altura **como a imagem aparece**, aplicando a rotação do EXIF.
 *
 * ⚠️ **É a regra que mais importa aqui.** A câmera do celular grava o sensor
 * sempre na mesma orientação — 4032×3024, paisagem — e anota "gire 90°" num
 * campo do EXIF. A foto que a pessoa tirou em pé chega, nos bytes, deitada.
 *
 * O caso concreto: uma foto tirada em pé chega como 4032×3024 com orientação 6.
 * Sem girar, a proporção calculada é 1,33 — dentro da faixa do feed. Girada, a
 * proporção real é 0,75, que não cabe no feed e só serve a Stories. Ou seja, sem
 * esta correção o sistema diria que a imagem serve para o feed, para o Instagram
 * recortá-la depois sem avisar.
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

  return IMAGE_MIME;
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
