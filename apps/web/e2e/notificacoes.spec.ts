import { expect, test, type Page } from "@playwright/test";
import { createAccount, resetAccounts } from "./support/accounts-db";
import { ESTADO_APROVADOR, ESTADO_EDITOR, ESTADO_SUPER_ADMIN } from "./support/estado";
import { criarMidia } from "./support/media-db";
import { limparAvisos, semearAviso } from "./support/notifications-db";
import { semearPostagem } from "./support/posts-db";

/**
 * O sino (RF-J01): o número na navegação, a lista com a frase montada na hora, e
 * tocar leva à tela certa e marca como lido.
 *
 * Os avisos são semeados no banco — quem os grava de verdade é a API, na
 * transação do que os causou, e isso tem teste no Jest. O último teste faz o
 * caminho inteiro: o editor envia e o aprovador vê.
 */
const CONTA = "loja.aurora";

test.beforeEach(async () => {
  await resetAccounts();
  await limparAvisos();
  await createAccount({ username: CONTA, name: "Loja Aurora", timezone: "America/Sao_Paulo" });
});

/**
 * O sino visível: a barra lateral no computador, a barra inferior no celular. As
 * duas estão no HTML, e o CSS esconde uma.
 */
const sino = (page: Page) => page.locator('a[href="/notificacoes"]:visible');
const lista = (page: Page) => page.getByRole("list", { name: "Notificações" });

test.describe("o sino", () => {
  test.use({ storageState: ESTADO_SUPER_ADMIN });

  test("sem aviso nenhum, o sino não tem número e a tela explica o que aparece ali", async ({ page }) => {
    await page.goto(`/c/${CONTA}/postagens`);
    await expect(sino(page)).toBeVisible();
    await expect(sino(page)).toHaveAccessibleName("Notificações");

    await sino(page).click();

    await expect(page).toHaveURL(/\/notificacoes$/);
    await expect(page.getByText(/Nenhuma notificação por aqui/)).toBeVisible();
  });

  test("o número aparece no sino, e a lista diz o que houve com o horário da conta", async ({ page }) => {
    const midia = await criarMidia({ width: 1080, height: 1350 });
    const falhou = await semearPostagem({
      status: "FALHOU",
      failureCause: "TOKEN_INVALID",
      // 13h UTC é 10h em São Paulo: a frase usa o fuso da conta, não o do navegador.
      scheduledAt: new Date("2030-01-15T13:00:00Z"),
      media: [{ id: midia.id }],
    });
    await semearAviso({ type: "CONTA_SEM_ACESSO", target: "conta", to: "e2e-setup-super" });
    await semearAviso({ type: "PUBLICACAO_FALHOU", target: { post: falhou }, to: "e2e-setup-super" });

    await page.goto(`/c/${CONTA}/postagens`);
    await expect(sino(page)).toHaveAccessibleName("Notificações (2 não lidas)");
    await expect(sino(page)).toContainText("2");

    await sino(page).click();

    const itens = lista(page).getByRole("listitem");
    await expect(itens).toHaveCount(2);
    // O mais recente primeiro.
    await expect(itens.nth(0)).toContainText("A publicação de 15/01 às 10:00 em @loja.aurora falhou.");
    await expect(itens.nth(1)).toContainText("@loja.aurora perdeu o acesso ao Instagram");
    await expect(page.getByText("2 não lidas", { exact: true })).toBeVisible();
  });

  test("tocar abre a postagem e o número cai", async ({ page }) => {
    const midia = await criarMidia({ width: 1080, height: 1350 });
    const falhou = await semearPostagem({ status: "FALHOU", failureCause: "TOKEN_INVALID", media: [{ id: midia.id }] });
    await semearAviso({ type: "PUBLICACAO_FALHOU", target: { post: falhou }, to: "e2e-setup-super" });
    await semearAviso({ type: "CONTA_SEM_ACESSO", target: "conta", to: "e2e-setup-super" });

    await page.goto("/notificacoes");
    await lista(page).getByRole("button", { name: /A publicação/ }).click();

    await expect(page).toHaveURL(new RegExp(`/c/${CONTA}/postagens/${falhou}$`));

    // De volta ao sino: no celular, a página da postagem esconde a barra inferior.
    await page.goto("/notificacoes");
    await expect(sino(page)).toHaveAccessibleName("Notificações (1 não lida)");
    await expect(page.getByText("1 não lida", { exact: true })).toBeVisible();
  });

  test("marcar todas como lidas zera o número", async ({ page }) => {
    await semearAviso({ type: "CONTA_SEM_ACESSO", target: "conta", to: "e2e-setup-super" });
    await semearAviso({ type: "CONTA_SEM_ACESSO", target: "conta", to: "e2e-setup-super" });

    await page.goto("/notificacoes");
    await page.getByRole("button", { name: "Marcar todas como lidas" }).click();

    await expect(page.getByText("Tudo lido")).toBeVisible();
    await expect(sino(page)).toHaveAccessibleName("Notificações");
    // Lidos continuam na lista: o sino é histórico, não caixa de entrada que esvazia.
    await expect(lista(page).getByRole("listitem")).toHaveCount(2);
  });

  test("o aviso de outra pessoa não aparece", async ({ page }) => {
    await semearAviso({ type: "CONTA_SEM_ACESSO", target: "conta", to: "e2e-setup-editor" });

    await page.goto("/notificacoes");

    await expect(page.getByText(/Nenhuma notificação por aqui/)).toBeVisible();
    await expect(sino(page)).toHaveAccessibleName("Notificações");
  });

  test("aviso de postagem que não existe mais não quebra a lista", async ({ page }) => {
    await semearAviso({
      type: "AGUARDANDO_APROVACAO",
      target: { post: "0190a0b1-0000-7000-8000-000000000000" },
      to: "e2e-setup-super",
    });

    await page.goto("/notificacoes");

    await expect(lista(page)).toContainText("Esta postagem não existe mais.");
  });
});

/*
 * O caminho inteiro, sem semear o aviso: o editor envia para revisão pela tela, e
 * o aprovador encontra o aviso no sino — gravado pela API, na transação do envio.
 */
test("o editor envia para revisão, e o aprovador vê o aviso no sino", async ({ browser }) => {
  const midia = await criarMidia({ width: 1080, height: 1350 });
  const rascunho = await semearPostagem({
    status: "RASCUNHO",
    author: "e2e-setup-editor",
    media: [{ id: midia.id, altText: "Três copos de cold brew" }],
  });

  const editor = await browser.newContext({ storageState: ESTADO_EDITOR });
  const paginaDoEditor = await editor.newPage();
  await paginaDoEditor.goto(`/c/${CONTA}/postagens/${rascunho}`);
  await paginaDoEditor.getByRole("button", { name: "Enviar para revisão" }).click();
  await expect(paginaDoEditor.getByRole("heading", { name: "Aguardando aprovação" })).toBeVisible();
  await editor.close();

  const aprovador = await browser.newContext({ storageState: ESTADO_APROVADOR });
  const pagina = await aprovador.newPage();
  await pagina.goto("/notificacoes");

  await expect(lista(pagina)).toContainText("Uma postagem de @loja.aurora aguarda aprovação.");
  await lista(pagina).getByRole("button", { name: /aguarda aprovação/ }).click();
  await expect(pagina).toHaveURL(new RegExp(`/c/${CONTA}/postagens/${rascunho}$`));
  await aprovador.close();
});
