import { expect, test } from "@playwright/test";
import { ESTADO_SUPER_ADMIN } from "./support/estado";

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

  test("um arquivo vazio é recusado", async ({ page }) => {
    await page.setInputFiles('input[type="file"]', {
      name: "vazio.jpg",
      mimeType: "image/jpeg",
      buffer: Buffer.alloc(0),
    });

    await expect(page.getByRole("main").getByRole("alert")).toContainText(/vazio/i);
  });
});
