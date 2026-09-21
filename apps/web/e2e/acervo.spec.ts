import { expect, test } from "@playwright/test";
import { ESTADO_SUPER_ADMIN } from "./support/estado";
import { imagemDe } from "./support/imagem";
import { resetAccounts } from "./support/accounts-db";
import { criarMidia } from "./support/media-db";

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
    await expect(page.getByRole("heading", { name: "Acervo", exact: true })).toBeVisible();
    await expect(page.getByText(/JPEG de até 8 MB/)).toBeVisible();
    await expect(page.getByText(/320 pixels de largura/)).toBeVisible();

    // E não promete uma faixa de proporção: ela depende do formato de destino,
    // que só a composição conhece (RF-B03).
    await expect(page.getByText(/4:5 e 1\.91:1/)).toHaveCount(0);
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
   * A foto de celular tirada em pé é 3:4, e o feed aceita no máximo 4:5. Ela não
   * está errada — só não serve a esse formato —, então a tela **oferece** as duas
   * saídas em vez de recortar sozinha. Recortar à força destruiria uma arte 9:16
   * feita para Stories, que é válida como está (RF-B03).
   */
  test("foto que não serve ao feed oferece as duas saídas", async ({ page }) => {
    await page.setInputFiles('input[type="file"]', {
      name: "foto-em-pe.jpg",
      mimeType: "image/jpeg",
      buffer: imagemDe(1512, 2016),
    });

    await expect(page.getByText(/não serve para Feed/i)).toBeVisible();
    await expect(page.getByText(/serve para Stories/i)).toBeVisible();
    await expect(page.getByRole("button", { name: /enviar como está/i })).toBeVisible();
    await expect(page.getByRole("button", { name: /recortar para feed/i })).toBeVisible();
    // A terceira saída: quem escolheu o arquivo errado não pode ficar preso aqui.
    await expect(page.getByRole("button", { name: /escolher outra imagem/i })).toBeVisible();

    // E nenhuma recusa: o caminho deixou de terminar em erro.
    await expect(page.getByRole("main").getByRole("alert")).toHaveCount(0);
  });

  test("quem escolhe recortar chega na prévia, com a faixa do feed", async ({ page }) => {
    await page.setInputFiles('input[type="file"]', {
      name: "foto-em-pe.jpg",
      mimeType: "image/jpeg",
      buffer: imagemDe(1512, 2016),
    });

    await page.getByRole("button", { name: /recortar para feed/i }).click();

    await expect(page.getByText(/Recortar para Feed/i)).toBeVisible();
    await expect(page.getByText(/4:5 a 1\.91:1/)).toBeVisible();
    await expect(page.getByRole("img", { name: /prévia do recorte/i })).toBeVisible();
    await expect(page.getByLabel(/do topo à base/i)).toBeVisible();
    await expect(page.getByRole("button", { name: /usar este recorte/i })).toBeVisible();
  });

  test("dá para voltar do recorte e enviar como está", async ({ page }) => {
    await page.setInputFiles('input[type="file"]', {
      name: "foto-em-pe.jpg",
      mimeType: "image/jpeg",
      buffer: imagemDe(1512, 2016),
    });

    await page.getByRole("button", { name: /recortar para feed/i }).click();
    await page.getByRole("button", { name: "Voltar" }).click();

    await expect(page.getByRole("button", { name: /enviar como está/i })).toBeVisible();
  });

  test("foto que já cabe no feed não pergunta nada", async ({ page }) => {
    await page.setInputFiles('input[type="file"]', {
      name: "quadrada.jpg",
      mimeType: "image/jpeg",
      buffer: imagemDe(1080, 1080),
    });

    await expect(page.getByText(/não serve para Feed/i)).toHaveCount(0);
    await expect(page.getByRole("button", { name: /recortar para feed/i })).toHaveCount(0);
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

/**
 * A listagem (RF-B04) — a metade que faltava.
 *
 * Até 21/09/2026 o Acervo recebia imagens que nunca eram usadas: não havia rota
 * de leitura, a tela não listava, e a composição mandava uma imagem nova a cada
 * postagem.
 */
test.describe("acervo — o que já foi enviado", () => {
  test.use({ storageState: ESTADO_SUPER_ADMIN });

  test.beforeEach(async () => {
    await resetAccounts();
  });

  test("sem nada enviado, a tela explica para que o acervo serve", async ({ page }) => {
    await page.goto("/acervo");

    await expect(page.getByText("Nenhuma imagem ainda")).toBeVisible();
    await expect(page.getByText(/pronto para virar postagem em qualquer conta/i)).toBeVisible();
  });

  test("as imagens enviadas aparecem, com as medidas", async ({ page }) => {
    await criarMidia({ width: 1080, height: 1350 });
    await page.goto("/acervo");

    await expect(page.getByRole("heading", { name: /No acervo/i })).toBeVisible();
    await expect(page.getByText("1080 × 1350")).toBeVisible();
    await expect(page.getByText("Nenhuma imagem ainda")).toHaveCount(0);
  });
});
