/**
 * Imagens de teste **montadas em código**, não guardadas como arquivo.
 *
 * Duas razões. A dimensão vira parâmetro — um teste de proporção precisa de
 * meia dúzia de tamanhos, e seriam seis arquivos. E **nada de binário embutido
 * em base64**: a varredura de segredos da CI procura `EAA` seguido de 60
 * alfanuméricos, o formato do token da Meta, e base64 de imagem contém essa
 * sequência por coincidência — já reprovou um push por isso.
 *
 * O que sai daqui é um JPEG de verdade no que importa para a validação: a
 * assinatura, os segmentos e o `SOF0` com as medidas. Não tem pixel nenhum, e
 * não precisa ter — nada no PostIt decodifica a imagem, só lê o cabeçalho.
 */

export interface JpegOptions {
  readonly width: number;
  readonly height: number;
  /** Orientação EXIF de 1 a 8. Sem ela, o arquivo sai sem bloco EXIF. */
  readonly orientation?: number;
  /** Enche o arquivo até este tamanho, para exercitar o limite de bytes. */
  readonly padToBytes?: number;
  /** Marca como MPO — a foto 3D que a Meta recusa, e que começa igual. */
  readonly mpo?: boolean;
}

const SOI = Buffer.from([0xff, 0xd8]);
const EOI = Buffer.from([0xff, 0xd9]);

export function jpegBytes(options: JpegOptions): Buffer {
  const partes = [SOI, options.orientation === undefined ? app0() : app1Exif(options.orientation)];

  if (options.mpo === true) partes.push(app2Mpf());
  partes.push(sof0(options.width, options.height), EOI);

  const base = Buffer.concat(partes);
  if (options.padToBytes === undefined || options.padToBytes <= base.length) return base;

  // O enchimento vai DEPOIS do EOI: o leitor já encontrou as medidas e parou, e
  // o arquivo continua com o tamanho que o teste pediu.
  return Buffer.concat([base, Buffer.alloc(options.padToBytes - base.length, 0x20)]);
}

/** O JFIF que todo JPEG real traz logo depois da assinatura. */
function app0(): Buffer {
  return Buffer.concat([
    Buffer.from([0xff, 0xe0, 0x00, 0x10]),
    Buffer.from("JFIF\0", "latin1"),
    Buffer.from([0x01, 0x01, 0x00, 0x00, 0x01, 0x00, 0x01, 0x00, 0x00]),
  ]);
}

/**
 * Bloco EXIF com uma entrada só: a tag 0x0112, orientação.
 *
 * ⚠️ A entrada IFD é tag(2) + tipo(2) + contagem(4) + valor(4), e o **valor fica
 * no deslocamento 8**, não no 6. Escrever no lugar errado faz o leitor devolver
 * orientação nenhuma — e o teste passa achando que testou a rotação. Custou uma
 * hora para descobrir na primeira vez.
 */
function app1Exif(orientation: number): Buffer {
  const exif = Buffer.alloc(32);
  exif.write("Exif\0\0", 0, "latin1");
  exif.write("II", 6, "latin1"); // little endian
  exif.writeUInt16LE(0x002a, 8);
  exif.writeUInt32LE(8, 10); // onde começa o IFD0
  exif.writeUInt16LE(1, 14); // uma entrada
  exif.writeUInt16LE(0x0112, 16); // tag: orientação
  exif.writeUInt16LE(3, 18); // tipo: SHORT
  exif.writeUInt32LE(1, 20); // contagem
  exif.writeUInt16LE(orientation, 24); // valor
  exif.writeUInt32LE(0, 28); // fim da cadeia

  const tamanho = Buffer.alloc(2);
  tamanho.writeUInt16BE(2 + exif.length, 0);

  return Buffer.concat([Buffer.from([0xff, 0xe1]), tamanho, exif]);
}

/** O APP2 que identifica um MPO. É só isto que o separa de um JPEG comum. */
function app2Mpf(): Buffer {
  const conteudo = Buffer.alloc(12);
  conteudo.write("MPF\0", 0, "latin1");

  const tamanho = Buffer.alloc(2);
  tamanho.writeUInt16BE(2 + conteudo.length, 0);

  return Buffer.concat([Buffer.from([0xff, 0xe2]), tamanho, conteudo]);
}

/** O segmento que carrega as medidas: altura antes da largura. */
function sof0(width: number, height: number): Buffer {
  const sof = Buffer.alloc(21);
  sof.writeUInt16BE(0xffc0, 0);
  sof.writeUInt16BE(17, 2); // tamanho do segmento
  sof.writeUInt8(8, 4); // bits por amostra
  sof.writeUInt16BE(height, 5);
  sof.writeUInt16BE(width, 7);
  sof.writeUInt8(3, 9); // três componentes
  return sof;
}

/** Um PNG de 1 pixel, para o teste de "só JPEG". Em hexadecimal, nunca base64. */
export function pngBytes(): Buffer {
  return Buffer.from(
    "89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c489" +
      "0000000d4944415478da636460f85f0f0002870180eb47ba92000000004945" +
      "4e44ae426082",
    "hex",
  );
}
