import zlib from "node:zlib";

/**
 * Uma imagem **decodificável de verdade**, com as medidas pedidas.
 *
 * ⚠️ Aqui não serve o JPEG de cabeçalho que os testes da API usam: o navegador
 * **decodifica a imagem**, e um arquivo sem pixel nenhum falha em
 * `createImageBitmap`. Sai um PNG cinza montado na hora — dados uniformes
 * comprimem a quase nada, então uma "foto" de 1512×2016 dá poucos kilobytes.
 *
 * Declarado como JPEG ou como PNG, dá no mesmo: a tela decide pelos bytes, vê
 * um PNG e o converte para JPEG antes do envio (RF-B06, ADR 0027) — por isso a
 * API, que também confere os bytes, aceita.
 */
export function imagemDe(width: number, height: number): Buffer {
  const chunk = (tipo: string, dados: Buffer): Buffer => {
    const tamanho = Buffer.alloc(4);
    tamanho.writeUInt32BE(dados.length, 0);
    const corpo = Buffer.concat([Buffer.from(tipo, "latin1"), dados]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(zlib.crc32(corpo), 0);
    return Buffer.concat([tamanho, corpo, crc]);
  };

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr.writeUInt8(8, 8); // bits por amostra
  ihdr.writeUInt8(0, 9); // tons de cinza
  // Cada linha começa com o byte de filtro; o resto é o pixel, todo igual.
  const linhas = Buffer.alloc((width + 1) * height, 0x80);
  for (let y = 0; y < height; y += 1) linhas[y * (width + 1)] = 0;

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", zlib.deflateSync(linhas)),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}
