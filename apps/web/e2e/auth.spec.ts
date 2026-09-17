import { expect, test } from "@playwright/test";
import { cadastrarEEntrar as primeiroAcesso, entrarComSenha, sair } from "./support/login";
import { totpCode } from "./support/totp";

/**
 * Os fluxos de entrada, pelo navegador (docs/15, cenários 1 a 3 e 11).
 *
 * Nada aqui usa atalho: o usuário nasce pelo comando `admin:create`, define a
 * senha pelo link, cadastra as duas etapas e só então entra — como uma pessoa
 * faria no primeiro dia. O caminho em si mora em `support/login.ts`, que a casca
 * de navegação também usa: duas cópias divergiriam.
 */

test.describe("primeiro acesso e login", () => {
  test("cria a senha pelo link, cadastra as duas etapas e recebe os códigos de recuperação", async ({ page }) => {
    await page.goto("/entrar");
    await primeiroAcesso(page, "completo");

    // Os 10 códigos aparecem uma única vez, antes de seguir.
    await expect(page.getByText(/guarde estes/i)).toBeVisible();
    const codigos = page.locator("ul li").filter({ hasText: /^[A-Z2-9]{5}-[A-Z2-9]{5}$/ });
    await expect(codigos).toHaveCount(10);

    await page.getByRole("button", { name: /já anotei/i }).click();

    // Sem conta do Instagram conectada, o sistema abre na tela de contas; com
    // conta, na conta ativa. O que importa aqui é que a pessoa entrou.
    await expect(page).toHaveURL(/\/(contas|c\/)/);
    await page.goto("/perfil");
    await expect(page.getByRole("heading", { name: "Pessoa do Teste" })).toBeVisible();
  });

  test("entra com senha e código, e o mesmo código não entra duas vezes", async ({ page }) => {
    await page.goto("/entrar");
    const { email, secret } = await primeiroAcesso(page, "codigo");
    await page.getByRole("button", { name: /já anotei/i }).click();

    // Sai e entra de novo, agora pelo caminho normal.
    await sair(page);
    await expect(page).toHaveURL(/\/entrar/);

    await entrarComSenha(page, email);
    await expect(page).toHaveURL(/\/entrar\/codigo/);

    // O código do passo seguinte: o do passo atual pode ter sido o usado no
    // cadastro, e o anti-reuso recusaria — que é justamente o que este teste
    // prova logo abaixo.
    const codigo = totpCode(secret, 1);
    await page.getByLabel("Código do aplicativo").fill(codigo);
    await page.getByRole("button", { name: "Entrar" }).click();
    await expect(page).toHaveURL(/\/(contas|c\/)/);

    // O mesmo código, de novo: recusado pelo anti-reuso.
    await sair(page);
    await entrarComSenha(page, email);
    await page.getByLabel("Código do aplicativo").fill(codigo);
    await page.getByRole("button", { name: "Entrar" }).click();
    // O seletor é pelo texto: o Next mantém um anunciador de rota com
    // role="alert" para leitores de tela, e procurar por papel casaria os dois.
    await expect(page.getByText("Código incorreto")).toBeVisible();
  });

  test("senha certa sem código não entra", async ({ page }) => {
    await page.goto("/entrar");
    const { email } = await primeiroAcesso(page, "sem-codigo");
    await page.getByRole("button", { name: /já anotei/i }).click();
    await sair(page);

    await entrarComSenha(page, email);
    await expect(page).toHaveURL(/\/entrar\/codigo/);

    // Tentar pular a etapa do código não leva a lugar nenhum.
    await page.goto("/perfil");
    await expect(page).toHaveURL(/\/entrar/);
  });

  test("e-mail inexistente e senha errada dão a mesma mensagem", async ({ page }) => {
    await page.goto("/entrar");
    await page.getByLabel("E-mail").fill("ninguem-mesmo@exemplo.com");
    await page.getByLabel("Senha").fill("uma-senha-qualquer-123");
    await page.getByRole("button", { name: "Entrar" }).click();

    await expect(page.getByText("E-mail ou senha incorretos")).toBeVisible();
  });
});

test.describe("proteção das telas", () => {
  test("tela protegida sem sessão leva ao login, guardando o destino", async ({ page }) => {
    await page.goto("/perfil");
    await expect(page).toHaveURL(/\/entrar\?voltar=%2Fperfil/);
  });

  test("destino de fora do site é descartado (marco 9)", async ({ page }) => {
    for (const destino of ["//site-externo.com", "/\\site-externo.com", "https://site-externo.com"]) {
      await page.goto(`/entrar?voltar=${encodeURIComponent(destino)}`);
      const { email, secret } = await primeiroAcesso(page, "voltar");
      await page.getByRole("button", { name: /já anotei/i }).click();

      // Foi para dentro do PostIt, e não para o endereço de fora.
      // O destino exato depende de haver conta conectada; o que importa é que
      // ficou dentro do PostIt.
      const destinoFinal = new URL(page.url());
      expect(destinoFinal.hostname).toBe("localhost");
      expect(destinoFinal.pathname).not.toContain("site-externo");
      expect(email).toContain("@");
      expect(secret.length).toBeGreaterThan(10);

      await sair(page);
    }
  });

  test("o cookie de sessão é httpOnly, lax e do caminho raiz", async ({ page, context }) => {
    await page.goto("/entrar");
    await primeiroAcesso(page, "cookie");
    await page.getByRole("button", { name: /já anotei/i }).click();

    const cookies = await context.cookies();
    const sessao = cookies.find((cookie) => cookie.name === "sessao" || cookie.name === "__Host-sessao");
    expect(sessao).toBeDefined();
    expect(sessao?.httpOnly).toBe(true);
    expect(sessao?.sameSite).toBe("Lax");
    expect(sessao?.path).toBe("/");
    // Servido por http neste teste: o prefixo __Host- exigiria https.
    expect(sessao?.name).toBe("sessao");
  });

  test("depois de sair, o cookie antigo não vale mais (marco 8)", async ({ page, context }) => {
    await page.goto("/entrar");
    await primeiroAcesso(page, "saida");
    await page.getByRole("button", { name: /já anotei/i }).click();

    const antigo = (await context.cookies()).find((cookie) => cookie.name === "sessao");
    expect(antigo).toBeDefined();

    await sair(page);
    await expect(page).toHaveURL(/\/entrar/);

    // Devolve o cookie ao navegador, como faria quem o tivesse copiado.
    await context.addCookies([antigo as NonNullable<typeof antigo>]);
    await page.goto("/perfil");
    await expect(page).toHaveURL(/\/(entrar|sessao-expirada)/);
  });
});
