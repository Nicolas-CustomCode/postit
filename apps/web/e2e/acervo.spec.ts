import { expect, test } from "@playwright/test";
import { ESTADO_SUPER_ADMIN } from "./support/estado";
import { imagemDe } from "./support/imagem";
import { createAccount, resetAccounts } from "./support/accounts-db";
import { criarMidia, usarMidiaEmPostagem } from "./support/media-db";

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
    await expect(page.getByText(/PNG, WebP e fotos maiores são convertidos/)).toBeVisible();

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
   * PNG não é recusado: vira JPEG no navegador antes do envio, e a tela avisa
   * (RF-B06, ADR 0027). A API continua recusando PNG — é a última barreira.
   */
  test("um PNG é convertido e aceito, com aviso", async ({ page }) => {
    await page.setInputFiles('input[type="file"]', {
      name: "foto.png",
      mimeType: "image/png",
      buffer: imagemDe(1080, 1080),
    });

    await expect(page.getByText(/Convertida de PNG para JPEG/)).toBeVisible();
    await expect(page.getByText("1080 × 1080 pixels")).toBeVisible();
    await expect(page.getByRole("button", { name: /usar esta imagem/i })).toBeVisible();
    await expect(page.getByRole("main").getByRole("alert")).toHaveCount(0);
  });

  test("uma imagem enorme é reduzida, com as medidas antes e depois", async ({ page }) => {
    await page.setInputFiles('input[type="file"]', {
      name: "panorama.png",
      mimeType: "image/png",
      buffer: imagemDe(5000, 400),
    });

    // O lado maior para em 2160, com a proporção preservada.
    await expect(page.getByText(/reduzida de 5000 × 400 para 2160 × 173/)).toBeVisible();
    await expect(page.getByText("2160 × 173 pixels")).toBeVisible();
  });

  test("um arquivo que não é imagem é recusado", async ({ page }) => {
    await page.setInputFiles('input[type="file"]', {
      name: "notas.jpg",
      mimeType: "image/jpeg",
      buffer: Buffer.from("isto não é uma imagem, é um texto qualquer"),
    });

    await expect(page.getByRole("main").getByRole("alert")).toContainText(/não consegui ler/i);
  });

  test("GIF é recusado, com o motivo", async ({ page }) => {
    await page.setInputFiles('input[type="file"]', {
      name: "animacao.gif",
      mimeType: "image/gif",
      buffer: Buffer.from("GIF89a\u0001\u0000\u0001\u0000", "latin1"),
    });

    await expect(page.getByRole("main").getByRole("alert")).toContainText(/primeiro quadro/i);
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

    await expect(page.getByRole("img", { name: /prévia da imagem escolhida/i })).toBeVisible();
    await expect(page.getByText(/não serve para Feed/i)).toBeVisible();
    await expect(page.getByText(/serve para Stories/i)).toBeVisible();
    await expect(page.getByRole("button", { name: /enviar como está/i })).toBeVisible();
    await expect(page.getByRole("button", { name: /ajustar para feed/i })).toBeVisible();
    // A terceira saída: quem escolheu o arquivo errado não pode ficar preso aqui.
    await expect(page.getByRole("button", { name: /escolher outra/i })).toBeVisible();

    // E nenhuma recusa: o caminho deixou de terminar em erro.
    await expect(page.getByRole("main").getByRole("alert")).toHaveCount(0);
  });

  test("o ajuste oferece recortar e imagem inteira, com a faixa do feed", async ({ page }) => {
    await page.setInputFiles('input[type="file"]', {
      name: "foto-em-pe.jpg",
      mimeType: "image/jpeg",
      buffer: imagemDe(1512, 2016),
    });

    await page.getByRole("button", { name: /ajustar para feed/i }).click();

    await expect(page.getByText(/4:5 a 1\.91:1/)).toBeVisible();
    await expect(page.getByRole("button", { name: "Recortar" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Imagem inteira" })).toBeVisible();
    // O recorte é o que abre, porque é o que preserva a resolução.
    await expect(page.getByRole("img", { name: /prévia do recorte/i })).toBeVisible();
    await expect(page.getByLabel(/do topo à base/i)).toBeVisible();
    await expect(page.getByRole("button", { name: /usar este recorte/i })).toBeVisible();
  });

  /*
   * O guarda-costas da decisão "zero grau de liberdade": sem zoom, a imagem
   * inteira ocupa o eixo que não ganhou faixa e fica centrada no outro. Um
   * controle de posição ali só permitiria faixa assimétrica, que é defeito.
   */
  test("no modo imagem inteira não há controle de posição", async ({ page }) => {
    await page.setInputFiles('input[type="file"]', {
      name: "foto-em-pe.jpg",
      mimeType: "image/jpeg",
      buffer: imagemDe(1512, 2016),
    });

    await page.getByRole("button", { name: /ajustar para feed/i }).click();
    await page.getByRole("button", { name: "Imagem inteira" }).click();

    await expect(page.getByLabel(/do topo à base/i)).toHaveCount(0);
    await expect(page.getByRole("img", { name: /prévia do enquadramento/i })).toBeVisible();
    await expect(page.getByText(/faixas brancas nas sobras/i)).toBeVisible();
    await expect(page.getByRole("button", { name: /usar a imagem inteira/i })).toBeVisible();
  });

  test("dá para voltar do recorte e enviar como está", async ({ page }) => {
    await page.setInputFiles('input[type="file"]', {
      name: "foto-em-pe.jpg",
      mimeType: "image/jpeg",
      buffer: imagemDe(1512, 2016),
    });

    await page.getByRole("button", { name: /ajustar para feed/i }).click();
    await page.getByRole("button", { name: "Voltar" }).click();

    await expect(page.getByRole("button", { name: /enviar como está/i })).toBeVisible();
  });

  /*
   * Até 21/09/2026 este caminho ia direto para o armazenamento: clicava-se e 8 MB
   * partiam sem nenhuma tela. Agora toda imagem passa pela confirmação — o que
   * muda entre os casos são os botões, não a tela.
   */
  test("foto que já cabe no feed pede confirmação, sem falar em recorte", async ({ page }) => {
    await page.setInputFiles('input[type="file"]', {
      name: "quadrada.jpg",
      mimeType: "image/jpeg",
      buffer: imagemDe(1080, 1080),
    });

    await expect(page.getByRole("img", { name: /prévia da imagem escolhida/i })).toBeVisible();
    await expect(page.getByRole("button", { name: /usar esta imagem/i })).toBeVisible();
    await expect(page.getByText("1080 × 1080 pixels")).toBeVisible();

    // Nada de recorte: não há o que recortar numa imagem que já serve.
    await expect(page.getByText(/não serve para Feed/i)).toHaveCount(0);
    await expect(page.getByRole("button", { name: /ajustar para feed/i })).toHaveCount(0);
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

/**
 * Excluir do acervo (RF-B07).
 *
 * ⚠️ **O arquivo não some de verdade aqui.** A mídia é semeada no banco com uma
 * chave que nunca existiu no MinIO, e apagar chave inexistente é sucesso no S3 —
 * então o fluxo roda inteiro, mas quem prova que o **objeto** saiu é o teste de
 * integração da API, que fala com o armazenamento de verdade.
 */
test.describe("acervo — excluir", () => {
  test.use({ storageState: ESTADO_SUPER_ADMIN });

  const lixeira = (page: import("@playwright/test").Page) =>
    page.getByRole("button", { name: /^excluir a imagem de/i });

  test.beforeEach(async () => {
    await resetAccounts();
  });

  test("a lixeira do card apaga direto, sem perguntar", async ({ page }) => {
    await criarMidia({ width: 1080, height: 1350 });
    await page.goto("/acervo");

    await lixeira(page).first().click();

    await expect(page.getByText("Nenhuma imagem ainda")).toBeVisible();
    await expect(page.getByText("1080 × 1350")).toHaveCount(0);
  });

  /*
   * ⚠️ `toHaveCSS`, e não `.click()`: o Playwright considera `opacity: 0`
   * **visível** e clicaria de qualquer jeito — um teste com clique passaria sem
   * provar nada sobre o hover.
   */
  test("no computador a lixeira só aparece com o cursor sobre o card", async ({ page, isMobile }) => {
    test.skip(isMobile === true, "no toque não existe hover, e lá ela fica sempre visível");
    await criarMidia({ width: 1080, height: 1350 });
    await page.goto("/acervo");

    await expect(lixeira(page).first()).toHaveCSS("opacity", "0");

    // Escopado em `main`: sem isso, o primeiro `listitem` da página é da
    // navegação lateral, e o cursor iria parar no lugar errado.
    await page.getByRole("main").getByRole("listitem").first().hover();

    await expect(lixeira(page).first()).toHaveCSS("opacity", "1");
  });

  test("no celular a lixeira está sempre à mão", async ({ page, isMobile }) => {
    test.skip(isMobile !== true, "é o caso do toque, onde hover não existe");
    await criarMidia({ width: 1080, height: 1350 });
    await page.goto("/acervo");

    await expect(lixeira(page).first()).toHaveCSS("opacity", "1");
  });

  test("imagem em uso mostra o motivo e não deixa excluir", async ({ page }) => {
    const { id } = await criarMidia({ width: 1080, height: 1350 });
    await createAccount({ username: "loja.aurora", name: "Loja Aurora" });
    await usarMidiaEmPostagem(id, "RASCUNHO");
    await page.goto("/acervo");

    await expect(page.getByText("Em uso numa postagem")).toBeVisible();
    await expect(lixeira(page).first()).toBeDisabled();
  });

  /*
   * O beco que este requisito abre: descartar a postagem não apaga o vínculo, e
   * sem isto a imagem ficaria presa no acervo para sempre.
   */
  test("postagem descartada solta a imagem", async ({ page }) => {
    const { id } = await criarMidia({ width: 1080, height: 1350 });
    await createAccount({ username: "loja.aurora", name: "Loja Aurora" });
    await usarMidiaEmPostagem(id, "CANCELADO");
    await page.goto("/acervo");

    await expect(page.getByText("Em uso numa postagem")).toHaveCount(0);
    await lixeira(page).first().click();

    await expect(page.getByText("Nenhuma imagem ainda")).toBeVisible();
  });

  test("excluir várias pergunta antes, e dá para desistir", async ({ page }) => {
    await criarMidia({ width: 1080, height: 1350 });
    await criarMidia({ width: 1080, height: 1080 });
    await page.goto("/acervo");

    await page.getByRole("button", { name: "Selecionar" }).click();
    // A lixeira some no modo seleção: um gesto destrutivo por card.
    await expect(lixeira(page)).toHaveCount(0);

    await page.getByRole("checkbox").first().click();
    await page.getByRole("checkbox").nth(1).click();
    await expect(page.getByText("2 imagens selecionadas")).toBeVisible();

    await page.getByRole("button", { name: "Excluir 2" }).click();
    // `alertdialog`, e não `dialog`: a confirmação é destrutiva e declara esse
    // papel — é o que a distingue da folha do acervo na composição.
    await expect(page.getByRole("alertdialog")).toBeVisible();

    // Desistir não apaga nada.
    await page.getByRole("alertdialog").getByRole("button", { name: "Cancelar" }).click();
    await expect(page.getByText("1080 × 1350")).toBeVisible();

    await page.getByRole("button", { name: "Excluir 2" }).click();
    await page.getByRole("button", { name: "Excluir 2 imagens" }).click();

    await expect(page.getByText("Nenhuma imagem ainda")).toBeVisible();
  });

  test("sair do modo seleção limpa o que estava marcado", async ({ page }) => {
    await criarMidia({ width: 1080, height: 1350 });
    await page.goto("/acervo");

    await page.getByRole("button", { name: "Selecionar" }).click();
    await page.getByRole("checkbox").first().click();
    await expect(page.getByText("1 imagem selecionada")).toBeVisible();

    await page.getByRole("button", { name: "Cancelar" }).click();
    await page.getByRole("button", { name: "Selecionar" }).click();

    await expect(page.getByText("0 imagens selecionadas")).toBeVisible();
  });
});
