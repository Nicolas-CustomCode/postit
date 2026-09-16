import { expect, test, type Page } from "@playwright/test";
import { criarUsuario } from "./support/admin-cli";
import { secretFromOtpauth, totpCode } from "./support/totp";

/**
 * Os fluxos de entrada, pelo navegador (docs/15, cenários 1 a 3 e 11).
 *
 * Nada aqui usa atalho: o usuário nasce pelo comando `admin:create`, define a
 * senha pelo link, cadastra as duas etapas e só então entra — como uma pessoa
 * faria no primeiro dia.
 */

const SENHA = "senha-do-teste-2026";

/** Primeiro acesso completo. Devolve o que é preciso para entrar de novo. */
async function primeiroAcesso(page: Page, sufixo: string): Promise<{ email: string; secret: string }> {
  const { email, signupUrl } = criarUsuario(new URL(page.url() || "http://localhost:3100").origin, sufixo);

  await page.goto(signupUrl);
  await expect(page.getByText(email)).toBeVisible();
  await page.getByLabel("Nova senha").fill(SENHA);
  await page.getByLabel("Repita a senha").fill(SENHA);
  await page.getByRole("button", { name: "Salvar senha" }).click();

  // Sem sessão de brinde: o link define a senha e manda para o login.
  await expect(page).toHaveURL(/\/entrar/);
  await entrarComSenha(page, email);

  // Primeiro login cai no cadastro das duas etapas.
  await expect(page).toHaveURL(/\/entrar\/cadastro/);
  const otpauth = await page.getByRole("link", { name: /abrir no aplicativo/i }).getAttribute("href");
  const secret = secretFromOtpauth(otpauth ?? "");

  await page.getByLabel("Código de 6 dígitos").fill(totpCode(secret));
  await page.getByRole("button", { name: /confirmar e entrar/i }).click();

  return { email, secret };
}

async function entrarComSenha(page: Page, email: string): Promise<void> {
  await page.getByLabel("E-mail").fill(email);
  await page.getByLabel("Senha").fill(SENHA);
  await page.getByRole("button", { name: "Entrar" }).click();
}

test.describe("primeiro acesso e login", () => {
  test("cria a senha pelo link, cadastra as duas etapas e recebe os códigos de recuperação", async ({ page }) => {
    await page.goto("/entrar");
    await primeiroAcesso(page, "completo");

    // Os 10 códigos aparecem uma única vez, antes de seguir.
    await expect(page.getByText(/guarde estes/i)).toBeVisible();
    const codigos = page.locator("ul li").filter({ hasText: /^[A-Z2-9]{5}-[A-Z2-9]{5}$/ });
    await expect(codigos).toHaveCount(10);

    await page.getByRole("button", { name: /já anotei/i }).click();
    await expect(page).toHaveURL(/\/perfil/);
    await expect(page.getByRole("heading", { name: "Pessoa do Teste" })).toBeVisible();
  });

  test("entra com senha e código, e o mesmo código não entra duas vezes", async ({ page }) => {
    await page.goto("/entrar");
    const { email, secret } = await primeiroAcesso(page, "codigo");
    await page.getByRole("button", { name: /já anotei/i }).click();

    // Sai e entra de novo, agora pelo caminho normal.
    await page.getByRole("button", { name: "Sair" }).click();
    await expect(page).toHaveURL(/\/entrar/);

    await entrarComSenha(page, email);
    await expect(page).toHaveURL(/\/entrar\/codigo/);

    // O código do passo seguinte: o do passo atual pode ter sido o usado no
    // cadastro, e o anti-reuso recusaria — que é justamente o que este teste
    // prova logo abaixo.
    const codigo = totpCode(secret, 1);
    await page.getByLabel("Código do aplicativo").fill(codigo);
    await page.getByRole("button", { name: "Confirmar" }).click();
    await expect(page).toHaveURL(/\/perfil/);

    // O mesmo código, de novo: recusado pelo anti-reuso.
    await page.getByRole("button", { name: "Sair" }).click();
    await entrarComSenha(page, email);
    await page.getByLabel("Código do aplicativo").fill(codigo);
    await page.getByRole("button", { name: "Confirmar" }).click();
    // O seletor é pelo texto: o Next mantém um anunciador de rota com
    // role="alert" para leitores de tela, e procurar por papel casaria os dois.
    await expect(page.getByText("Código incorreto")).toBeVisible();
  });

  test("senha certa sem código não entra", async ({ page }) => {
    await page.goto("/entrar");
    const { email } = await primeiroAcesso(page, "sem-codigo");
    await page.getByRole("button", { name: /já anotei/i }).click();
    await page.getByRole("button", { name: "Sair" }).click();

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
      await expect(page).toHaveURL(new RegExp(`^http://localhost:\\d+/(perfil)?$`));
      expect(email).toContain("@");
      expect(secret.length).toBeGreaterThan(10);

      await page.getByRole("button", { name: "Sair" }).click();
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

    await page.getByRole("button", { name: "Sair" }).click();
    await expect(page).toHaveURL(/\/entrar/);

    // Devolve o cookie ao navegador, como faria quem o tivesse copiado.
    await context.addCookies([antigo as NonNullable<typeof antigo>]);
    await page.goto("/perfil");
    await expect(page).toHaveURL(/\/(entrar|sessao-expirada)/);
  });
});
