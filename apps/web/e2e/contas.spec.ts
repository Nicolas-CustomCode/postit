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

  test("a tela de contas mostra as duas, com fuso e prazo do acesso", async ({ page }) => {
    await page.goto("/contas");

    await expect(page.getByText("Loja Aurora")).toBeVisible();
    await expect(page.getByText("Café Brisa")).toBeVisible();
    await expect(page.getByText("America/Sao_Paulo", { exact: false })).toBeVisible();
    await expect(page.getByText("Europe/Lisbon", { exact: false })).toBeVisible();
    await expect(page.getByText(/acesso válido por 5[0-9] dias/i).first()).toBeVisible();
  });

  test("conta com acesso vencido aparece marcada", async ({ page }) => {
    await createAccount({ username: "zeta.velha", name: "Zeta", tokenExpiresInDays: -2 });
    await page.goto("/contas");

    await expect(page.getByText("Acesso expirado")).toBeVisible();
  });
});
