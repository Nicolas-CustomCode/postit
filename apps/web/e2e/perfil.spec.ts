import { expect, test } from "@playwright/test";
import { ESTADO_SUPER_ADMIN } from "./support/estado";
import { cadastrarEEntrar, entrarComSenha, sair } from "./support/login";
import { totpCode } from "./support/totp";

/**
 * A tela de Perfil (RF-H07).
 *
 * Dividida em dois blocos de propósito:
 *
 * - **Leitura** reaproveita a sessão da preparação. É rápido e cobre o que a
 *   tela passou a mostrar: identidade, papel, estado da segurança e aparelhos.
 * - **Escrita** cria usuário próprio, porque gerar códigos novos e encerrar
 *   aparelho mexem em sessão — na sessão compartilhada, derrubariam os testes
 *   seguintes de um jeito difícil de rastrear (docs/15).
 */
test.describe("perfil — o que a tela mostra", () => {
  test.use({ storageState: ESTADO_SUPER_ADMIN });

  test.beforeEach(async ({ page }) => {
    await page.goto("/perfil");
  });

  test("mostra quem é, o papel e desde quando", async ({ page }) => {
    const principal = page.getByRole("main");

    await expect(page.getByRole("heading", { name: "Pessoa do Teste" })).toBeVisible();
    await expect(principal.getByText("Super admin").first()).toBeVisible();
    await expect(principal.getByText(/No PostIt desde/)).toBeVisible();
  });

  test("super admin vê que tem todas as permissões", async ({ page }) => {
    const principal = page.getByRole("main");

    await expect(principal.getByRole("heading", { name: "O que você pode fazer" })).toBeVisible();
    await expect(principal.getByText(/todas as permissões, em todas as contas/i)).toBeVisible();
  });

  test("a segurança diz o estado de cada coisa, não só oferece botões", async ({ page }) => {
    const principal = page.getByRole("main");

    await expect(principal.getByRole("heading", { name: "Segurança" })).toBeVisible();
    // A senha do usuário de teste é gravada direto no banco pelo comando, então
    // a data não existe — e a tela diz isso em vez de inventar uma.
    await expect(principal.getByText(/Definida em|Data não registrada/)).toBeVisible();
    await expect(principal.getByText(/^Ativa( desde .*)?$/)).toBeVisible();
    await expect(principal.getByText(/\d+ de \d+/)).toBeVisible();
    await expect(principal.getByText(/não é possível desligar/i)).toBeVisible();
  });

  test("os formulários ficam fechados até alguém pedir", async ({ page }) => {
    const principal = page.getByRole("main");

    // É a mudança de forma do redesenho: antes os três ficavam abertos juntos.
    await expect(principal.getByLabel("Senha atual")).toBeHidden();

    await principal.getByRole("button", { name: "Trocar senha" }).click();
    await expect(principal.getByLabel("Senha atual")).toBeVisible();

    await principal.getByRole("button", { name: "Cancelar" }).click();
    await expect(principal.getByLabel("Senha atual")).toBeHidden();
  });

  test("uma linha aberta por vez: cada código do aplicativo vale uma vez só", async ({ page }) => {
    const principal = page.getByRole("main");

    await principal.getByRole("button", { name: "Trocar senha" }).click();
    await expect(principal.getByLabel("Senha atual")).toBeVisible();

    await principal.getByRole("button", { name: "Gerar novos" }).click();
    await expect(principal.getByLabel("Senha atual")).toBeHidden();
  });

  test("o aparelho atual aparece traduzido e marcado", async ({ page }) => {
    const principal = page.getByRole("main");

    await expect(principal.getByRole("heading", { name: "Aparelhos conectados" })).toBeVisible();
    // Exato: o cartão de notificações também fala "neste aparelho".
    await expect(principal.getByText("ESTE APARELHO", { exact: true })).toBeVisible();
    // O navegador dos testes é Chromium; o rótulo nunca é o user-agent cru.
    await expect(principal.getByText(/^(Chrome|Safari|Edge|Firefox|Aparelho desconhecido)/).first()).toBeVisible();
    await expect(principal.getByText(/conectado desde/).first()).toBeVisible();
    await expect(principal.getByText(/Nenhum outro aparelho está conectado/)).toBeVisible();
  });

  test("o botão de sair fica no cabeçalho da tela", async ({ page }) => {
    await expect(page.getByRole("button", { name: "Sair do PostIt" })).toBeVisible();
  });
});

test.describe("perfil — o que a tela faz", () => {
  test("gerar códigos novos mostra os dez, uma vez só", async ({ page }) => {
    await page.goto("/entrar");
    const { secret } = await cadastrarEEntrar(page, "perfil-codigos");
    await page.getByRole("button", { name: /já anotei/i }).click();
    await page.waitForURL(/\/(contas|c\/)/);

    await page.goto("/perfil");
    const principal = page.getByRole("main");
    await expect(principal.getByText("10 de 10")).toBeVisible();

    await principal.getByRole("button", { name: "Gerar novos" }).click();
    // Passo seguinte: o código do passo atual foi gasto no login, e o anti-reuso
    // o recusaria.
    await principal.getByLabel("Código do aplicativo").fill(totpCode(secret, 1));
    await principal.getByRole("button", { name: /gerar 10 códigos novos/i }).click();

    const codigos = principal.locator("li").filter({ hasText: /^[A-Z2-9]{5}-[A-Z2-9]{5}$/ });
    await expect(codigos).toHaveCount(10);

    await sair(page);
  });

  test("encerrar um aparelho tira ele da lista e mantém este", async ({ page, browser }) => {
    await page.goto("/entrar");
    const { email, secret } = await cadastrarEEntrar(page, "perfil-aparelhos");
    await page.getByRole("button", { name: /já anotei/i }).click();
    await page.waitForURL(/\/(contas|c\/)/);

    /*
     * Um segundo aparelho de verdade: contexto novo, cookies próprios, login
     * inteiro. Criar a segunda sessão direto no banco testaria menos — é pelo
     * login que ela ganha user-agent e IP, que é o que a lista mostra.
     */
    const outroAparelho = await browser.newContext();
    const outraAba = await outroAparelho.newPage();
    await outraAba.goto("/entrar");
    await entrarComSenha(outraAba, email);
    // Passo seguinte: o código do cadastro já foi gasto, e o anti-reuso recusa.
    await outraAba.getByLabel("Código do aplicativo").fill(totpCode(secret, 1));
    await outraAba.getByRole("button", { name: "Entrar" }).click();
    await outraAba.waitForURL(/\/(contas|c\/)/);

    await page.goto("/perfil");
    const principal = page.getByRole("main");
    const encerrar = principal.getByRole("button", { name: "Encerrar" });
    await expect(encerrar).toHaveCount(1);

    await encerrar.click();
    await expect(principal.getByText(/Nenhum outro aparelho está conectado/)).toBeVisible();
    // Este aparelho continua: a rota recusa encerrar a própria sessão.
    await expect(principal.getByText("ESTE APARELHO", { exact: true })).toBeVisible();

    // E a sessão do outro morreu de verdade, não só sumiu da lista.
    await outraAba.goto("/perfil");
    await expect(outraAba).toHaveURL(/\/(entrar|sessao-expirada)/);

    await outroAparelho.close();
    await sair(page);
  });
});
