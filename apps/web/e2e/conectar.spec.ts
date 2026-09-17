import { expect, test } from "@playwright/test";
import { resetAccounts } from "./support/accounts-db";
import { ESTADO_COMUM, ESTADO_SUPER_ADMIN } from "./support/estado";

/**
 * Conectar uma conta do Instagram pelo navegador (RF-A01, RF-A02).
 *
 * Percorre o caminho inteiro contra a **Meta falsa**, que aprova a autorização
 * na hora e devolve o navegador para a rota de retorno (AGENTS.md, regra 23).
 * É o primo automático do marco 13, que continua sendo feito à mão contra a
 * Meta de verdade — este aqui pega a regressão; aquele prova que a integração
 * real funciona.
 */
test.describe("conectar conta", () => {
  test.use({ storageState: ESTADO_SUPER_ADMIN });

  test.beforeEach(async () => {
    await resetAccounts();
  });

  test("autoriza, volta e abre já na conta conectada", async ({ page }) => {
    await page.goto("/contas/conectar");

    await page.getByRole("button", { name: /autorizar no instagram/i }).click();

    // A volta cai direto na conta: é o que a pessoa veio fazer.
    await page.waitForURL(/\/c\/[^/]+\/calendario/);
    await expect(page.getByRole("main").getByText("@conta.de.testes")).toBeVisible();
  });

  test("depois de conectar, a conta aparece na lista com o prazo do acesso", async ({ page }) => {
    await page.goto("/contas/conectar");
    await page.getByRole("button", { name: /autorizar no instagram/i }).click();
    await page.waitForURL(/\/c\/[^/]+\/calendario/);

    await page.goto("/contas");
    const principal = page.getByRole("main");
    // `exact`: a linha da conta traz o nome e, logo abaixo, "@conta.de.testes ·
    // America/Sao_Paulo" — sem isto o seletor casa com os dois.
    await expect(principal.getByText("conta.de.testes", { exact: true })).toBeVisible();
    // 60 dias de token; a tela mostra o prazo, não a data crua.
    await expect(principal.getByText(/acesso válido por 5[0-9] dias/i)).toBeVisible();
  });

  test("conectar a mesma conta duas vezes é recusado com explicação", async ({ page }) => {
    await page.goto("/contas/conectar");
    await page.getByRole("button", { name: /autorizar no instagram/i }).click();
    await page.waitForURL(/\/c\/[^/]+\/calendario/);

    await page.goto("/contas/conectar");
    await page.getByRole("button", { name: /autorizar no instagram/i }).click();

    await page.waitForURL(/\/contas\/conectar\?erro=/);
    // Pelo texto, e não por `role=alert`: o Next mantém um anunciador de rota
    // com esse papel, e procurar por papel casaria os dois (docs/15).
    await expect(page.getByText(/já está conectada/i)).toBeVisible();
  });
});

test.describe("quem não pode gerenciar contas", () => {
  test.use({ storageState: ESTADO_COMUM });

  test("não chega na tela de conectar", async ({ page }) => {
    await resetAccounts();
    await page.goto("/contas/conectar");

    // Esconder não é proteger — a API recusaria de novo —, mas não faz sentido
    // mostrar um caminho que terminaria em 403.
    await expect(page.getByText(/não encontrada|not found/i).first()).toBeVisible();
  });
});
