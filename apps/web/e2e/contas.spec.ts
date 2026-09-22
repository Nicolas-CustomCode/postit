import { expect, test } from "@playwright/test";
import { ESTADO_SUPER_ADMIN } from "./support/estado";
import { createAccount, resetAccounts } from "./support/accounts-db";

/**
 * A conta ativa (RF-A09).
 *
 * As contas são criadas direto no banco porque conectar de verdade depende do
 * OAuth, que chega na próxima entrega. O que este arquivo cobre é o que não
 * depende dele: a conta ativa vem do endereço, trocar de conta é navegar, e duas
 * abas podem ficar em contas diferentes sem uma atrapalhar a outra.
 */
test.describe("conta ativa", () => {
  test.use({ storageState: ESTADO_SUPER_ADMIN });

  test.beforeEach(async ({ page }) => {
    await resetAccounts();
    await createAccount({ username: "aurora.loja", name: "Loja Aurora" });
    await createAccount({ username: "brisa.cafe", name: "Café Brisa", timezone: "Europe/Lisbon" });

    // A sessão vem pronta da preparação; aqui só entramos no sistema.
    await page.goto("/");
  });

  test("o sistema abre numa conta, e o endereço diz qual é", async ({ page }) => {
    await expect(page).toHaveURL(/\/c\/aurora\.loja\/calendario/);
    await expect(page.getByRole("main").getByText("@aurora.loja")).toBeVisible();
  });

  test("trocar de conta troca o endereço e mantém a mesma tela", async ({ page }) => {
    await page.goto("/c/aurora.loja/metricas");

    // O seletor existe duas vezes no DOM — barra lateral e topo do celular —, e
    // só um está visível. O clique vai no painel que abriu.
    await page.getByRole("button", { name: /conta ativa: aurora\.loja/i }).filter({ visible: true }).click();
    await page.getByRole("dialog").getByRole("button", { name: /café brisa/i }).click();

    // Mesma seção, outra conta — sem escolher nada de novo.
    await expect(page).toHaveURL(/\/c\/brisa\.cafe\/metricas/);
    await expect(page.getByRole("main").getByText("@brisa.cafe")).toBeVisible();
  });

  test("ao voltar, o sistema abre na última conta usada", async ({ page }) => {
    await page.goto("/c/brisa.cafe/calendario");
    await page.goto("/");

    await expect(page).toHaveURL(/\/c\/brisa\.cafe\/calendario/);
  });

  test("duas abas ficam em contas diferentes sem uma trocar a da outra", async ({ page, context }) => {
    await page.goto("/c/aurora.loja/calendario");

    const outraAba = await context.newPage();
    await outraAba.goto("/c/brisa.cafe/calendario");
    await expect(outraAba.getByRole("main").getByText("@brisa.cafe")).toBeVisible();

    // A primeira aba continua onde estava: a conta mora no endereço, não numa
    // preferência guardada no servidor.
    await page.reload();
    await expect(page).toHaveURL(/\/c\/aurora\.loja\/calendario/);
    await expect(page.getByRole("main").getByText("@aurora.loja")).toBeVisible();

    await outraAba.close();
  });

  /*
   * Escopado no `<main>`, como o teste da aba acima: desde 22/09/2026 a casca
   * mostra a conta lembrada **também** nas telas gerais, e o nome dela aparece
   * duas vezes na página — no seletor e no cartão. O assunto aqui é o cartão.
   */
  test("a tela de contas mostra as duas, com fuso e prazo do acesso", async ({ page }) => {
    await page.goto("/contas");
    const conteudo = page.getByRole("main");

    await expect(conteudo.getByText("Loja Aurora")).toBeVisible();
    await expect(conteudo.getByText("Café Brisa")).toBeVisible();
    await expect(conteudo.getByText("America/Sao_Paulo", { exact: false })).toBeVisible();
    await expect(conteudo.getByText("Europe/Lisbon", { exact: false })).toBeVisible();
    await expect(conteudo.getByText(/acesso válido por 5[0-9] dias/i).first()).toBeVisible();
  });

  test("conta com acesso vencido aparece marcada", async ({ page }) => {
    await createAccount({ username: "zeta.velha", name: "Zeta", tokenExpiresInDays: -2 });
    await page.goto("/contas");

    await expect(page.getByText("Acesso expirado")).toBeVisible();
  });
});

/**
 * A conta ativa precisa acompanhar a navegação pelo cliente.
 *
 * ⚠️ Regressão conhecida: derivar a conta ativa no layout do servidor não
 * funciona. No App Router o layout **não roda de novo** quando se navega entre
 * rotas que o compartilham — ele congela no valor da primeira carga completa. A
 * barra lateral ficava dizendo "Nenhuma conta" enquanto o endereço já estava
 * dentro de uma conta.
 */
test.describe("a conta ativa acompanha a navegação", () => {
  test.use({ storageState: ESTADO_SUPER_ADMIN });

  // Sem `page`: cada teste entra por onde precisa, porque a carga completa é
  // parte do que se prova aqui.
  test.beforeEach(async () => {
    await resetAccounts();
    await createAccount({ username: "aurora.loja", name: "Loja Aurora" });
    await createAccount({ username: "brisa.cafe", name: "Café Brisa" });
  });

  test("a barra lateral acompanha a conta escolhida numa tela geral", async ({ page, isMobile }) => {
    test.skip(isMobile === true, "a barra lateral não existe no celular");

    // Passa por aurora para o cookie ficar determinístico, e então vai para uma
    // tela geral — de onde a casca já mostra aquela conta.
    await page.goto("/c/aurora.loja/calendario");
    await page.goto("/contas");

    // Daqui em diante é navegação pelo cliente, que não recarrega o layout.
    await page.getByRole("button", { name: /conta ativa: aurora\.loja/i }).filter({ visible: true }).click();
    await page.getByRole("dialog").getByRole("button", { name: /café brisa/i }).click();
    await expect(page).toHaveURL(/\/c\/brisa\.cafe\//);

    // O seletor precisa ter acompanhado, em vez de ficar na conta anterior.
    await expect(page.getByRole("button", { name: /conta ativa: brisa\.cafe/i })).toBeVisible();
  });

  /*
   * O pedido de 22/09/2026: a conta escolhida continua à mão nas telas gerais.
   * Antes, abrir o Acervo dizia "Nenhuma conta" e apagava Calendário, Postagens
   * e Métricas — com o título "Conecte uma conta primeiro", mentira quando há
   * conta conectada. Voltar custava escolher a conta de novo.
   */
  test("a conta continua na casca ao abrir uma tela geral", async ({ page, isMobile }) => {
    test.skip(isMobile === true, "a barra lateral não existe no celular");

    await page.goto("/c/brisa.cafe/calendario");
    await page.goto("/acervo");

    await expect(page.getByRole("button", { name: /conta ativa: brisa\.cafe/i })).toBeVisible();

    // E os itens da conta continuam sendo link, apontando para ela.
    const menu = page.getByRole("navigation", { name: "Menu principal" });
    await expect(menu.getByRole("link", { name: "Calendário" })).toHaveAttribute(
      "href",
      "/c/brisa.cafe/calendario",
    );
  });

  /*
   * O defeito que o `rememberedAccount` sozinho tinha, e que nenhuma das outras
   * medidas pegava: ele nasce no layout, que congela na primeira carga completa.
   * Aqui a carga completa é em `aurora.loja` e **toda** navegação seguinte é
   * pelo cliente — sem o `useShellAccount`, a tela geral voltaria para `aurora`,
   * que não é onde a pessoa estava.
   */
  test("depois de trocar de conta, a tela geral lembra a nova", async ({ page, isMobile }) => {
    test.skip(isMobile === true, "a barra lateral não existe no celular");

    await page.goto("/c/aurora.loja/calendario");

    await page.getByRole("button", { name: /conta ativa: aurora\.loja/i }).filter({ visible: true }).click();
    await page.getByRole("dialog").getByRole("button", { name: /café brisa/i }).click();
    await expect(page).toHaveURL(/\/c\/brisa\.cafe\//);

    const menu = page.getByRole("navigation", { name: "Menu principal" });
    await menu.getByRole("link", { name: "Acervo" }).click();
    await expect(page).toHaveURL(/\/acervo$/);

    await expect(page.getByRole("button", { name: /conta ativa: brisa\.cafe/i })).toBeVisible();
  });
});
