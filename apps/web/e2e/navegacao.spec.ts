import { expect, test } from "@playwright/test";
import { ESTADO_COMUM, ESTADO_SUPER_ADMIN } from "./support/estado";
import { resetAccounts } from "./support/accounts-db";

/**
 * A casca do sistema (docs/13, "Navegação").
 *
 * Aqui ainda não há nenhuma conta do Instagram conectada — que é o estado real
 * de hoje e o mais importante de cobrir: sem conta, o sistema precisa orientar,
 * não quebrar. A navegação entre contas entra quando o OAuth existir.
 */
test.describe("casca de navegação", () => {
  test.use({ storageState: ESTADO_SUPER_ADMIN });

  test.beforeEach(async ({ page }) => {
    await resetAccounts();
    await page.goto("/");
  });

  test("sem conta conectada, o sistema abre na tela de contas", async ({ page }) => {
    await expect(page).toHaveURL(/\/contas$/);
    await expect(page.getByRole("heading", { name: "Nenhuma conta conectada" })).toBeVisible();
    await expect(page.getByRole("link", { name: /conectar a primeira conta/i })).toBeVisible();
  });

  test("a tela de conectar explica os dois passos exigidos pela Meta", async ({ page }) => {
    await page.goto("/contas/conectar");

    await expect(page.getByText(/conta precisa ser profissional/i)).toBeVisible();
    await expect(page.getByText(/aceitar o convite de testadora/i)).toBeVisible();
    await expect(page.getByRole("button", { name: /autorizar no instagram/i })).toBeEnabled();
  });

  test("um endereço de conta que não existe leva de volta às contas", async ({ page }) => {
    await page.goto("/c/conta-que-nao-existe/calendario");
    await expect(page).toHaveURL(/\/contas/);
  });

  test("o perfil continua acessível dentro da casca", async ({ page }) => {
    await page.goto("/perfil");
    await expect(page.getByRole("heading", { name: "Pessoa do Teste" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Sair do PostIt" })).toBeVisible();
  });
});

test.describe("casca no computador", () => {
  test.skip(({ isMobile }) => isMobile === true, "a barra lateral não existe no celular");
  test.use({ storageState: ESTADO_COMUM });

  test.beforeEach(async ({ page }) => {
    await resetAccounts();
    await page.goto("/");
  });

  test("a barra lateral tem os dois grupos e marca o que ainda não existe", async ({ page }) => {
    const menu = page.getByRole("navigation", { name: "Menu principal" });

    await expect(menu.getByText("Nesta conta")).toBeVisible();
    await expect(menu.getByText("Geral")).toBeVisible();
    await expect(menu.getByRole("link", { name: "Contas" })).toBeVisible();
    await expect(menu.getByRole("link", { name: "Perfil" })).toBeVisible();

    // Telas de fases seguintes aparecem, mas não são link: dizem quando chegam.
    await expect(menu.getByRole("link", { name: "Acervo" })).toHaveCount(0);
    await expect(menu.getByText("Acervo")).toBeVisible();
    await expect(menu.getByText("Fase 1").first()).toBeVisible();
  });

  test("quem não é super admin não vê Administração", async ({ page }) => {
    // O usuário do teste nasce sem privilégio: admin:create sem --super-admin.
    await expect(page.getByText("Administração")).toHaveCount(0);
  });

  test("o seletor de conta abre, avisa que não há contas e leva a gerenciar", async ({ page }) => {
    await page.getByRole("button", { name: /escolher conta/i }).click();

    await expect(page.getByText(/nenhuma conta conectada ainda/i)).toBeVisible();
    await page.getByRole("link", { name: "Gerenciar contas" }).click();
    await expect(page).toHaveURL(/\/contas$/);
  });
});

test.describe("casca no celular", () => {
  test.skip(({ isMobile }) => isMobile !== true, "esta casca só existe no celular");
  test.use({ storageState: ESTADO_SUPER_ADMIN });

  test.beforeEach(async ({ page }) => {
    await resetAccounts();
    await page.goto("/");
  });

  test("a barra inferior tem cinco alvos, todos com área de toque de 44 px", async ({ page }) => {
    const barra = page.getByRole("navigation", { name: "Menu principal" });
    const alvos = barra.locator(":scope > *");

    await expect(alvos).toHaveCount(5);

    for (const alvo of await alvos.all()) {
      const caixa = await alvo.boundingBox();
      // Acessibilidade (docs/13): nada menor que 44 × 44.
      expect(caixa?.height ?? 0).toBeGreaterThanOrEqual(44);
      expect(caixa?.width ?? 0).toBeGreaterThanOrEqual(44);
    }
  });

  test("a folha Mais abre com as telas que não cabem na barra", async ({ page }) => {
    await page.getByRole("button", { name: "Mais telas" }).click();

    await expect(page.getByRole("dialog").getByText("Contas")).toBeVisible();
    await expect(page.getByRole("dialog").getByText("Perfil")).toBeVisible();
    await expect(page.getByRole("dialog").getByText("Métricas")).toBeVisible();
  });

  test("a barra lateral do computador não aparece", async ({ page }) => {
    // Ela existe no HTML e é escondida por CSS, que é como a mesma página serve
    // aos dois tamanhos de tela. O que importa é não estar visível.
    await expect(page.getByText("Nesta conta")).toBeHidden();
  });
});
