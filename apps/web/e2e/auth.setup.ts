import { test as setup } from "@playwright/test";
import { ESTADO_COMUM, ESTADO_SUPER_ADMIN } from "./support/estado";
import { primeiroAcesso } from "./support/login";

/**
 * Entra uma vez e guarda o estado do navegador para os outros testes.
 *
 * ⚠️ Sem isto, **cada teste** refazia o primeiro acesso inteiro: criar usuário
 * por um processo Node, definir senha com argon2, cadastrar as duas etapas e
 * entrar. São uns 12 segundos por teste, com Next, API e Postgres na mesma
 * máquina — e era isso que estourava o tempo dos testes de forma aparentemente
 * aleatória, em lugares diferentes a cada execução.
 *
 * Quem testa o próprio fluxo de entrada (`auth.spec.ts`) continua fazendo tudo à
 * mão, com usuários próprios: ele desloga, e deslogar invalidaria o estado
 * compartilhado no servidor.
 */
setup("entra como super admin", async ({ page }) => {
  await page.goto("/entrar");
  await primeiroAcesso(page, "setup-super", true);
  await page.context().storageState({ path: ESTADO_SUPER_ADMIN });
});

setup("entra como usuário comum", async ({ page }) => {
  await page.goto("/entrar");
  await primeiroAcesso(page, "setup-comum", false);
  await page.context().storageState({ path: ESTADO_COMUM });
});
