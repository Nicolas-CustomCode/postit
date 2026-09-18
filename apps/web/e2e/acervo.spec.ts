import zlib from "node:zlib";
import { expect, test } from "@playwright/test";
import { ESTADO_SUPER_ADMIN } from "./support/estado";

/**
 * Uma imagem **decodificável de verdade**, com as medidas pedidas.
 *
 * ⚠️ Aqui não serve o JPEG de cabeçalho que os testes da API usam: o navegador
 * **decodifica a imagem**, e um arquivo sem pixel nenhum falha em
 * `createImageBitmap`. Sai um PNG cinza montado na hora — dados uniformes
 * comprimem a quase nada, então uma "foto" de 1512×2016 dá poucos kilobytes.
 *
 * O tipo declarado no envio continua sendo JPEG: quem escolhe o arquivo no
 * navegador informa o tipo, e é isso que a conferência local olha. O que sai do
 * recorte é um JPEG de verdade, gerado pelo canvas — por isso a API, que confere
 * os bytes, aceita.
 */
function imagemDe(width: number, height: number): Buffer {
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

/**
 * O envio de imagem pela tela (RF-B01, RF-B02).
 *
 * O que só o navegador prova: que a tela recusa **antes de enviar** o que dá
 * para saber sem abrir o arquivo, e que a mensagem diz qual regra pegou e qual é
 * o limite — nunca "arquivo inválido" (docs/04, "Estados de interface").
 *
 * O caminho feliz completo, com o arquivo chegando ao armazenamento, é o roteiro
 * manual da fase: ele depende do MinIO de verdade e do CORS, e é isso que o
 * item V-15 manda conferir à mão.
 */
test.describe("acervo — enviar imagem", () => {
  test.use({ storageState: ESTADO_SUPER_ADMIN });

  test.beforeEach(async ({ page }) => {
    await page.goto("/acervo");
  });

  test("a tela explica os limites do Instagram antes de escolher o arquivo", async ({ page }) => {
    await expect(page.getByRole("heading", { name: "Acervo" })).toBeVisible();
    await expect(page.getByText(/JPEG de até 8 MB/)).toBeVisible();
    await expect(page.getByText(/4:5 e 1\.91:1/)).toBeVisible();
  });

  test("o Acervo aparece na navegação como tela pronta", async ({ page, isMobile }) => {
    test.skip(isMobile, "a barra lateral é do computador; no celular o Acervo fica na folha Mais");

    const menu = page.getByRole("navigation", { name: "Menu principal" });
    await expect(menu.getByRole("link", { name: "Acervo" })).toBeVisible();
  });

  /*
   * A recusa local, sem gastar envio: o docs/02 divide assim — o que dá para
   * conferir sem abrir o arquivo, a tela confere antes.
   */
  test("um PNG é recusado na hora, com a mensagem certa", async ({ page }) => {
    await page.setInputFiles('input[type="file"]', {
      name: "foto.png",
      mimeType: "image/png",
      buffer: Buffer.from("89504e470d0a1a0a", "hex"),
    });

    await expect(page.getByRole("main").getByRole("alert")).toContainText(/só aceita JPEG/i);
  });

  test("um arquivo grande demais é recusado com o tamanho dele na mensagem", async ({ page }) => {
    await page.setInputFiles('input[type="file"]', {
      name: "grande.jpg",
      mimeType: "image/jpeg",
      // 9 MB: acima do limite de 8 MB.
      buffer: Buffer.alloc(9_000_000, 0x20),
    });

    const alerta = page.getByRole("main").getByRole("alert");
    await expect(alerta).toContainText(/até 8 MB/);
    // O número real do arquivo, que é o que o docs/04 pede.
    await expect(alerta).toContainText(/9,0 MB/);
  });

  /*
   * O caso que motivou o recorte: foto de celular tirada em pé é 3:4, e o feed
   * aceita no máximo 4:5. Antes, ela era simplesmente recusada — a foto mais
   * comum que existe não entrava. Agora a tela oferece o corte.
   *
   * A imagem é montada com as medidas de uma foto de celular em pé.
   */
  test("foto em pé abre o recorte em vez de ser recusada", async ({ page }) => {
    await page.setInputFiles('input[type="file"]', {
      name: "foto-em-pe.jpg",
      mimeType: "image/jpeg",
      buffer: imagemDe(1512, 2016),
    });

    await expect(page.getByText(/precisa ser recortada/i)).toBeVisible();
    await expect(page.getByRole("img", { name: /prévia do recorte/i })).toBeVisible();
    await expect(page.getByLabel(/do topo à base/i)).toBeVisible();
    await expect(page.getByRole("button", { name: /usar este recorte/i })).toBeVisible();

    // E nenhuma recusa: o caminho deixou de terminar em erro.
    await expect(page.getByRole("main").getByRole("alert")).toHaveCount(0);
  });

  test("foto que já cabe não passa pelo recorte", async ({ page }) => {
    await page.setInputFiles('input[type="file"]', {
      name: "quadrada.jpg",
      mimeType: "image/jpeg",
      buffer: imagemDe(1080, 1080),
    });

    await expect(page.getByText(/precisa ser recortada/i)).toHaveCount(0);
  });

  test("um arquivo vazio é recusado", async ({ page }) => {
    await page.setInputFiles('input[type="file"]', {
      name: "vazio.jpg",
      mimeType: "image/jpeg",
      buffer: Buffer.alloc(0),
    });

    await expect(page.getByRole("main").getByRole("alert")).toContainText(/vazio/i);
  });
});
