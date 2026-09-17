import { expect, type Page } from "@playwright/test";
import { criarUsuario } from "./admin-cli";
import { secretFromOtpauth, totpCode } from "./totp";

/**
 * O primeiro acesso completo, como uma pessoa faria no primeiro dia: o usuário
 * nasce pelo comando `admin:create`, define a senha pelo link e cadastra as duas
 * etapas. Nenhum atalho — não existe modo de teste que pule o código.
 */
export const SENHA_DE_TESTE = "senha-do-teste-2026";

export interface UsuarioDeTeste {
  readonly email: string;
  readonly secret: string;
}

/**
 * Sai do sistema, esteja a pessoa no computador ou no celular.
 *
 * "Sair" mora no cartão do usuário: no rodapé da barra lateral, no computador, e
 * dentro da folha "Mais", no celular (artefato de identidade, `ComposicaoDesktop`).
 * Sem este apoio, cada teste precisaria saber em que tamanho de tela está.
 */
export async function sair(page: Page): Promise<void> {
  /*
   * Espera a casca aparecer ANTES de escolher o caminho.
   *
   * `isVisible()` responde na hora, sem esperar: chamado no meio da navegação
   * que vem do "já anotei", ele dizia "não está visível" e mandava o teste do
   * computador procurar a folha do celular, que lá não existe.
   */
  await page.getByRole("navigation", { name: "Menu principal" }).waitFor({ state: "visible" });

  // `exact`, senão "Sair" casaria também com o "Sair do PostIt" da tela de
  // Perfil: o nome acessível é comparado por trecho, não por igualdade.
  const naLateral = page.getByRole("button", { name: "Sair", exact: true });
  if (await naLateral.isVisible()) {
    await naLateral.click();
    return;
  }

  await page.getByRole("button", { name: "Mais telas" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Sair", exact: true }).click();
}

export async function entrarComSenha(page: Page, email: string): Promise<void> {
  await page.getByLabel("E-mail").fill(email);
  await page.getByLabel("Senha").fill(SENHA_DE_TESTE);

  const entrar = page.getByRole("button", { name: "Entrar" });
  await entrar.click();

  /*
   * Confere que a navegação aconteceu e, se não, clica de novo.
   *
   * O clique pode cair no intervalo entre a página desenhar e ficar interativa
   * — e aí ele não dispara nada. É um teste rápido demais, não um defeito do
   * produto: uma pessoa levaria segundos para digitar e clicar.
   */
  await page.waitForURL(/\/entrar\/(codigo|cadastro)/, { timeout: 10_000 }).catch(async () => {
    await entrar.click();
    await page.waitForURL(/\/entrar\/(codigo|cadastro)/);
  });
}

/**
 * Vai do link de cadastro até a tela dos códigos de recuperação, sem passar
 * dela — é onde os testes que conferem os códigos precisam parar.
 */
export async function cadastrarEEntrar(page: Page, sufixo: string, superAdmin = false): Promise<UsuarioDeTeste> {
  const origem = new URL(page.url() || "http://localhost:3100").origin;
  const { email, signupUrl } = criarUsuario(origem, sufixo, superAdmin);

  await page.goto(signupUrl);
  await expect(page.getByText(email)).toBeVisible();
  await page.getByLabel("Nova senha").fill(SENHA_DE_TESTE);
  await page.getByLabel("Repita a senha").fill(SENHA_DE_TESTE);
  await page.getByRole("button", { name: "Salvar senha" }).click();

  await expect(page).toHaveURL(/\/entrar/);
  await entrarComSenha(page, email);

  await expect(page).toHaveURL(/\/entrar\/cadastro/);
  const otpauth = await page.getByRole("link", { name: /abrir no aplicativo/i }).getAttribute("href");
  const secret = secretFromOtpauth(otpauth ?? "");

  await page.getByLabel("Código de 6 dígitos").fill(totpCode(secret));
  await page.getByRole("button", { name: /confirmar e entrar/i }).click();

  return { email, secret };
}

/** Deixa a pessoa logada, já dentro do sistema. */
export async function primeiroAcesso(page: Page, sufixo: string, superAdmin = false): Promise<UsuarioDeTeste> {
  const usuario = await cadastrarEEntrar(page, sufixo, superAdmin);
  await page.getByRole("button", { name: /já anotei/i }).click();

  /*
   * Espera o DESTINO FINAL, e não só "saiu do login".
   *
   * Depois do "já anotei" a navegação passa por `/`, que ainda redireciona para
   * a conta ativa ou para as contas. Esperar só sair de `/entrar` devolvia o
   * controle no meio do caminho, e o teste seguinte navegava por cima — a
   * navegação pendente chegava depois e trocava a página.
   */
  await page.waitForURL(/\/(contas|c\/)/);

  return usuario;
}
