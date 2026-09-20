import { expect, test } from "@playwright/test";
import { createAccount, resetAccounts } from "./support/accounts-db";
import { salvarComoOutraPessoa } from "./support/posts-db";
import { ESTADO_SUPER_ADMIN } from "./support/estado";

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

  test("criar um rascunho leva para a composição", async ({ page }) => {
    await conteudo(page).getByRole("link", { name: /nova postagem/i }).click();

    await expect(page.getByRole("heading", { name: "Nova postagem" })).toBeVisible();
    await page.getByLabel("Legenda").fill("Um dia bonito na loja");
    await page.getByRole("button", { name: /criar rascunho/i }).click();

    // A composição, já com a legenda que veio da tela anterior.
    await expect(page).toHaveURL(new RegExp(`/c/${CONTA}/postagens/[0-9a-f-]+$`));
    await expect(page.getByRole("heading", { name: "Compor" })).toBeVisible();
    await expect(page.getByLabel("Legenda")).toHaveValue("Um dia bonito na loja");
    // `exact` porque getByText é insensível a maiúsculas: sem ele, "Rascunho" da
    // pílula casa também com o botão "Salvar rascunho".
    await expect(page.getByText("Rascunho", { exact: true })).toBeVisible();
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

  test("descartar o rascunho volta para a lista", async ({ page }) => {
    await criarRascunho(page, "Rascunho a descartar");

    await page.getByRole("button", { name: "Descartar" }).click();

    await expect(page).toHaveURL(new RegExp(`/c/${CONTA}/postagens$`));
    await expect(conteudo(page).getByRole("link", { name: /rascunho a descartar/i })).toHaveCount(0);
  });
});

/** Cria um rascunho pela tela e devolve o identificador dele. */
async function criarRascunho(page: import("@playwright/test").Page, caption: string): Promise<string> {
  await page.goto(`/c/loja.aurora/postagens/nova`);
  if (caption !== "") await page.getByLabel("Legenda").fill(caption);
  await page.getByRole("button", { name: /criar rascunho/i }).click();

  await expect(page).toHaveURL(/\/postagens\/[0-9a-f-]+$/);
  return page.url().split("/").pop() as string;
}

