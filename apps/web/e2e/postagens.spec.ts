import { expect, test } from "@playwright/test";
import { createAccount, resetAccounts } from "./support/accounts-db";
import { salvarComoOutraPessoa } from "./support/posts-db";
import { ESTADO_SUPER_ADMIN } from "./support/estado";
import { criarMidia } from "./support/media-db";

/**
 * Compor uma postagem pela tela (RF-C01, RF-C03, RF-C12).
 *
 * O que só o navegador prova: que os contadores acompanham o que se digita, que
 * o caminho de criar leva à composição, e — o mais importante — que o aviso de
 * conflito **não apaga o que a pessoa escreveu**.
 */
test.describe("postagens", () => {
  test.use({ storageState: ESTADO_SUPER_ADMIN });

  const CONTA = "loja.aurora";

  /*
   * Tudo dentro de `main`. A barra inferior existe no HTML nos dois tamanhos de
   * tela — só o CSS a esconde no computador —, e o botão "+" dela tem o mesmo
   * nome acessível do link da página: sem este recorte, o locator casa com dois
   * elementos e o Playwright recusa.
   */
  const conteudo = (page: import("@playwright/test").Page) => page.getByRole("main");

  test.beforeEach(async ({ page }) => {
    await resetAccounts();
    await createAccount({ username: CONTA, name: "Loja Aurora" });
    await page.goto(`/c/${CONTA}/postagens`);
  });

  test("sem postagem nenhuma, a tela convida a criar a primeira", async ({ page }) => {
    await expect(page.getByRole("heading", { name: "Postagens" })).toBeVisible();
    await expect(page.getByText("Nenhuma postagem ainda")).toBeVisible();
    await expect(conteudo(page).getByRole("link", { name: /nova postagem/i })).toBeVisible();
  });

  /*
   * A tela de nova postagem **é** a composição (artboard `ComposicaoDesktop`):
   * formato, mídia, legenda e prévia, sem passo intermediário. A postagem só
   * nasce no banco quando se salva — senão cada visita a este endereço deixaria
   * um rascunho vazio para trás.
   */
  test("a tela de nova postagem já é a composição, com a prévia", async ({ page }) => {
    await conteudo(page).getByRole("link", { name: /nova postagem/i }).click();

    await expect(page.getByRole("heading", { name: "Nova postagem" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Formato" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Mídia" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Legenda" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Prévia" })).toBeVisible();
    // `exact` porque getByText é insensível a maiúsculas: sem ele, "Rascunho" da
    // pílula casa também com o botão "Salvar rascunho".
    await expect(page.getByText("Rascunho", { exact: true })).toBeVisible();
  });

  test("a prévia acompanha a legenda enquanto se digita", async ({ page }) => {
    await page.goto(`/c/${CONTA}/postagens/nova`);

    await expect(page.getByText("A legenda aparece aqui")).toBeVisible();
    await page.getByLabel("Legenda").fill("Um dia bonito na loja");

    await expect(page.getByText("Um dia bonito na loja")).toHaveCount(2); // campo e prévia
    await expect(page.getByText("Sem imagem ainda")).toBeVisible();
  });

  test("salvar na tela nova cria a postagem e leva para o endereço dela", async ({ page }) => {
    await page.goto(`/c/${CONTA}/postagens/nova`);
    await page.getByLabel("Legenda").fill("Um dia bonito na loja");
    await page.getByRole("button", { name: /salvar rascunho/i }).click();

    await expect(page).toHaveURL(new RegExp(`/c/${CONTA}/postagens/[0-9a-f-]+$`));
    await expect(page.getByLabel("Legenda")).toHaveValue("Um dia bonito na loja");
  });

  /*
   * A pergunta que motivou esta parte: "consigo enviar as imagens para o
   * Acervo, mas quando que uso?" — até 21/09/2026, nunca.
   *
   * O envio em si não roda aqui: o arquivo vai do navegador direto ao MinIO,
   * com política assinada e CORS, e isso é roteiro manual (docs/12, V-15). A
   * mídia é semeada no banco, e o que se prova é o que vem depois.
   */
  test("dá para escolher uma imagem do acervo na composição", async ({ page }) => {
    await criarMidia({ width: 1080, height: 1080 });
    await page.goto(`/c/${CONTA}/postagens/nova`);

    await expect(page.getByText("Sem imagem ainda")).toBeVisible();
    await page.getByRole("button", { name: /escolher do acervo/i }).click();
    await page.getByRole("dialog").getByRole("button").first().click();

    // A prévia passa a mostrar a imagem…
    await expect(page.getByText("Sem imagem ainda")).toHaveCount(0);
    // …e a tela continua sendo "Nova postagem": escolher não cria nada.
    await expect(page.getByRole("heading", { name: "Nova postagem" })).toBeVisible();
    await expect(page).toHaveURL(new RegExp(`/c/${CONTA}/postagens/nova$`));
  });

  test("a imagem escolhida é anexada quando se salva", async ({ page }) => {
    await criarMidia({ width: 1080, height: 1080 });
    await page.goto(`/c/${CONTA}/postagens/nova`);

    await page.getByLabel("Legenda").fill("Com foto");
    await page.getByRole("button", { name: /escolher do acervo/i }).click();
    await page.getByRole("dialog").getByRole("button").first().click();
    await page.getByRole("button", { name: /salvar rascunho/i }).click();

    await expect(page).toHaveURL(new RegExp(`/c/${CONTA}/postagens/[0-9a-f-]+$`));
    // A postagem existe com a imagem: o botão de ficar pronta libera.
    await expect(page.getByRole("button", { name: /marcar como pronta/i })).toBeEnabled();
  });

  /*
   * As incompatíveis aparecem apagadas, não escondidas: quem enviou uma arte
   * 9:16 precisa ver que ela está lá e por que não serve ao feed.
   */
  test("no acervo, a imagem que não serve ao formato aparece apagada", async ({ page }) => {
    await criarMidia({ width: 1080, height: 1920 });
    await page.goto(`/c/${CONTA}/postagens/nova`);

    await page.getByRole("button", { name: /escolher do acervo/i }).click();

    const folha = page.getByRole("dialog");
    await expect(folha.getByText(/não serve para Feed/i)).toBeVisible();
    await expect(folha.getByRole("button").first()).toBeDisabled();
  });

  /*
   * O outro defeito: bastava digitar uma data numa postagem nunca agendada para
   * a tela dizer que o horário tinha sido desmarcado.
   */
  test("digitar a data numa postagem nunca agendada não mostra aviso", async ({ page }) => {
    await criarRascunho(page, "Rascunho comum");

    await page.getByLabel("Data").fill("2030-10-15");
    await page.getByLabel("Hora").fill("10:00");

    await expect(page.getByText(/desmarcou o horário/i)).toHaveCount(0);
  });

  test("o formato muda o que a tela cobra", async ({ page }) => {
    await page.goto(`/c/${CONTA}/postagens/nova`);

    await expect(page.getByText(/proporção de 4:5 a 1\.91:1/i)).toBeVisible();
    await expect(page.getByText(/figurinhas, enquetes/i)).toHaveCount(0);

    await page.getByRole("button", { name: "Stories", exact: true }).click();

    // Stories não tem faixa, e ganha o aviso do RF-C11.
    await expect(page.getByText(/qualquer proporção/i)).toBeVisible();
    await expect(page.getByText(/figurinhas, enquetes/i)).toBeVisible();
    await expect(page.getByText("Como vai aparecer nos Stories")).toBeVisible();
  });

  test("Carrossel e Vídeo de feed deixaram de existir; Reels espera a Fase 2", async ({ page }) => {
    await page.goto(`/c/${CONTA}/postagens/nova`);

    // Carrossel virou quantidade de mídias, e vídeo de feed virou Reels (ADR
    // 0024): os dois saíram da tela, não ficaram apagados.
    for (const sumiu of ["Carrossel", "Vídeo de feed"]) {
      await expect(page.getByRole("button", { name: new RegExp(sumiu, "i") })).toHaveCount(0);
    }

    // Sem `exact`: o nome acessível inclui o selo "Fase 2".
    await expect(page.getByRole("button", { name: /reels/i })).toBeDisabled();
  });

  test("a postagem criada aparece na lista, com o trecho e a situação", async ({ page }) => {
    await criarRascunho(page, "Promoção de inverno");
    await page.goto(`/c/${CONTA}/postagens`);

    const item = conteudo(page).getByRole("link", { name: /promoção de inverno/i });
    await expect(item).toBeVisible();
    await expect(item.getByText("Rascunho", { exact: true })).toBeVisible();
  });

  /*
   * Os três contadores do RF-C03. O limite não impede digitar — impede marcar
   * como pronta —, então o que se prova aqui é o aviso, não o bloqueio.
   */
  test("os contadores acompanham a legenda e avisam ao passar do limite", async ({ page }) => {
    await criarRascunho(page, "");

    const legenda = page.getByLabel("Legenda");
    await legenda.fill("Olha isso #sol #mar #praia com @loja.aurora");

    await expect(page.getByText("3 / 30 hashtags")).toBeVisible();
    await expect(page.getByText("1 / 20 menções")).toBeVisible();
    await expect(page.getByText("43 / 2.200 caracteres")).toBeVisible();

    // E-mail não conta como menção: sem essa regra, escrever um contato na
    // legenda daria uma recusa incompreensível.
    await legenda.fill("Fale com contato@empresa.com");
    await expect(page.getByText("0 / 20 menções")).toBeVisible();
  });

  test("sem imagem, não dá para marcar como pronta", async ({ page }) => {
    await criarRascunho(page, "Só texto por enquanto");

    await expect(page.getByRole("button", { name: /marcar como pronta/i })).toBeDisabled();
  });

  /*
   * RF-C12, o requisito que mais custa se sair errado: quem salva por último
   * não pode perder o que digitou.
   */
  test("no conflito de edição, o texto digitado continua na tela", async ({ page }) => {
    const postId = await criarRascunho(page, "Versão original");

    // Outra pessoa salva primeiro — aqui, direto pela API interna, que é o
    // equivalente a outra aba com a postagem aberta.
    await salvarComoOutraPessoa(postId, "Mexida por outra pessoa");

    const legenda = page.getByLabel("Legenda");
    await legenda.fill("O que eu estava escrevendo");
    await page.getByRole("button", { name: /salvar rascunho/i }).click();

    // Dentro de `main`: o anunciador de rotas do Next também tem role="alert".
    await expect(conteudo(page).getByRole("alert")).toContainText(/foi alterada por/i);
    // O ponto do requisito: o texto não foi embora.
    await expect(legenda).toHaveValue("O que eu estava escrevendo");
    await expect(page.getByRole("button", { name: /descartar minhas alterações/i })).toBeVisible();
  });

  /*
   * Descartar traz o texto de **quem salvou antes**, não o desta tela: o valor
   * certo é o que está no servidor agora. Trazer de volta a legenda de quando a
   * tela carregou seria restaurar justamente a versão que acabou de ficar velha.
   */
  test("descartar as alterações traz o texto de quem salvou antes", async ({ page }) => {
    const postId = await criarRascunho(page, "Versão original");
    await salvarComoOutraPessoa(postId, "Mexida por outra pessoa");

    await page.getByLabel("Legenda").fill("O que eu estava escrevendo");
    await page.getByRole("button", { name: /salvar rascunho/i }).click();
    await page.getByRole("button", { name: /descartar minhas alterações/i }).click();

    await expect(page.getByLabel("Legenda")).toHaveValue("Mexida por outra pessoa");
  });

  /*
   * Agendar (RF-D01; ADR 0006). O que só a tela prova: que o fuso mostrado é o
   * da CONTA, e que o aviso aparece quando o horário sai do banco.
   */
  test("a seção de horário diz o fuso da conta, e não o do aparelho", async ({ page }) => {
    await page.goto(`/c/${CONTA}/postagens/nova`);

    await expect(page.getByRole("heading", { name: "Quando publicar" })).toBeVisible();
    // O nome sai do Intl, não de texto fixo: numa conta de Lisboa diria outro.
    await expect(page.getByText(/Brasília, o fuso da conta/i)).toBeVisible();
    await expect(page.getByText(/Salve o rascunho e marque como pronta/i)).toBeVisible();
  });

  /*
   * Os campos aceitam o horário desde o rascunho — é natural escolher a data
   * enquanto se escreve. Quem espera é o botão: agendar exige a postagem
   * pronta (invariante I-1), e a API recusaria de qualquer forma.
   */
  test("dá para escolher o horário no rascunho, mas agendar espera a postagem ficar pronta", async ({ page }) => {
    await criarRascunho(page, "Ainda rascunho");

    await expect(page.getByLabel("Data")).toBeEnabled();
    await page.getByLabel("Data").fill("2030-10-15");
    await page.getByLabel("Hora").fill("10:00");

    await expect(page.getByRole("button", { name: "Agendar", exact: true })).toBeDisabled();
  });

  test("descartar o rascunho volta para a lista", async ({ page }) => {
    await criarRascunho(page, "Rascunho a descartar");

    await page.getByRole("button", { name: "Descartar" }).click();

    await expect(page).toHaveURL(new RegExp(`/c/${CONTA}/postagens$`));
    await expect(conteudo(page).getByRole("link", { name: /rascunho a descartar/i })).toHaveCount(0);
  });
});

/**
 * Cria um rascunho pela tela e devolve o identificador dele.
 *
 * Salvar é o que cria: a tela de nova postagem não grava nada ao abrir.
 */
async function criarRascunho(page: import("@playwright/test").Page, caption: string): Promise<string> {
  await page.goto(`/c/loja.aurora/postagens/nova`);
  if (caption !== "") await page.getByLabel("Legenda").fill(caption);
  await page.getByRole("button", { name: /salvar rascunho/i }).click();

  await expect(page).toHaveURL(/\/postagens\/[0-9a-f-]+$/);
  return page.url().split("/").pop() as string;
}

