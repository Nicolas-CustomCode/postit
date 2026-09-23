import { defineConfig, devices } from "@playwright/test";
import { config as loadDotenv } from "dotenv";

// O .env único da raiz, como no next.config.ts: o Playwright roda fora do Next e
// precisa do endereço do banco de teste para subir a API. Na CI as variáveis já
// estão no processo, e o dotenv não as sobrescreve.
loadDotenv({ path: "../../.env", quiet: true });

/**
 * Testes de tela (docs/15, "Playwright"): `npm run test:e2e`.
 *
 * Rodam contra o build de produção (`next start`), e não contra o `next dev`: a
 * CSP de produção é mais estrita, e é ela que precisa passar. Por isso a porta é
 * própria, 3100 — um `npm run dev` aberto na 3010 não é reaproveitado por engano.
 * Antes, `npm run build`.
 *
 * Sobem três processos: o Next, a API (contra o banco de teste) e a Meta falsa.
 * Sem a API não há login, e o login é metade do que estas telas fazem.
 *
 * Dois tamanhos de tela, porque o PostIt funciona por completo nos dois. O
 * celular é um Pixel, que usa o mesmo Chromium: um navegador só para instalar
 * na CI.
 *
 * ## Quatro regras que custaram caro para aprender
 *
 * 1. **O teste monta o estado do banco; nunca herda.** Jest, Playwright e o
 *    desenvolvimento dividem o mesmo `postit_test`. Conta deixada por outro
 *    teste muda o destino do login e derruba um teste que nada tem a ver.
 * 2. **Não afirme o endereço final quando ele depende de dados.** Depois do
 *    login, o sistema abre na conta ativa ou nas contas, conforme haja conta
 *    conectada. Afirme a tela — título, papel —, não a URL.
 * 3. **A casca aparece duas vezes no HTML**, porque a mesma página serve ao
 *    computador e ao celular e o CSS esconde uma delas. Escope o seletor por
 *    região (`getByRole("navigation")`, `getByRole("dialog")`) e prefira
 *    `toBeHidden()` a `toHaveCount(0)`.
 * 4. **Ao mexer num teste, rode só o arquivo dele**, com `--repeat-each=3` para
 *    provocar intermitência. A suíte inteira, uma vez, no fim.
 */
const WEB_PORT = 3100;
const API_PORT = 3111;
const FAKE_META_PORT = 3199;

const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL ?? "";

export default defineConfig({
  testDir: "e2e",
  /*
   * Em série, um arquivo por vez. Todos os testes dividem o mesmo banco
   * `postit_test` e o mesmo servidor: em paralelo, um zera as contas enquanto o
   * outro as insere, e a lista sai duplicada — foi exatamente o que aconteceu.
   * É o mesmo motivo do `maxWorkers: 1` do Jest (docs/15).
   */
  fullyParallel: false,
  workers: 1,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [["list"], ["html", { open: "never" }]] : "list",
  /*
   * 90 s por teste, contra os 30 s padrão.
   *
   * Não é folga preguiçosa: cada teste fala com três servidores e um Postgres na
   * mesma máquina, e alguns ainda criam usuário por um processo Node com
   * argon2. Com 30 s, o que estourava era o tempo — e a falha aparecia num teste
   * diferente a cada execução, parecendo defeito intermitente do produto.
   */
  timeout: 90_000,
  expect: { timeout: 10_000 },
  use: {
    baseURL: `http://localhost:${WEB_PORT}`,
    trace: "retain-on-failure",
  },
  projects: [
    // Entra uma vez e guarda a sessão; os outros projetos começam logados.
    { name: "preparacao", testMatch: /auth\.setup\.ts/ },
    { name: "computador", use: { ...devices["Desktop Chrome"] }, dependencies: ["preparacao"] },
    { name: "celular", use: { ...devices["Pixel 7"] }, dependencies: ["preparacao"] },
  ],
  webServer: [
    {
      command: "npm run start",
      port: WEB_PORT,
      reuseExistingServer: false,
      env: {
        PORT: String(WEB_PORT),
        APP_URL: `http://localhost:${WEB_PORT}`,
        // Fala com a API destes testes, não com a do desenvolvimento.
        INTERNAL_API_URL: `http://127.0.0.1:${API_PORT}`,
      },
    },
    {
      // A API contra o banco de teste — o mesmo que o Jest usa, com a trava do
      // sufixo _test.
      command: "npm run start -w @repo/api",
      port: API_PORT,
      reuseExistingServer: false,
      env: {
        NODE_ENV: "test",
        API_HOST: "127.0.0.1",
        API_PORT: String(API_PORT),
        DATABASE_URL: TEST_DATABASE_URL,
        // A API fala com a Meta falsa, nunca com a real (AGENTS.md, regra 23).
        // Só o `NODE_ENV=test` acima permite esta troca: em qualquer outro
        // ambiente, estas três variáveis impedem o processo de subir.
        META_AUTH_URL: `http://127.0.0.1:${FAKE_META_PORT}`,
        META_TOKEN_URL: `http://127.0.0.1:${FAKE_META_PORT}`,
        META_GRAPH_URL: `http://127.0.0.1:${FAKE_META_PORT}`,
        IG_APP_ID: "app-de-teste",
        IG_APP_SECRET: "segredo-de-teste",
        IG_REDIRECT_URI: `http://localhost:${WEB_PORT}/contas/conectar/retorno`,
      },
    },
    {
      // A Meta falsa (apps/api/src/fake-meta). Só sobe com NODE_ENV=test; a
      // API aponta para ela a partir do Bloco C.
      command: "npm run fake-meta -w @repo/api",
      port: FAKE_META_PORT,
      reuseExistingServer: false,
      env: { NODE_ENV: "test", FAKE_META_PORT: String(FAKE_META_PORT) },
    },
    {
      /*
       * O worker — quem despacha e publica (Fase 1d), contra o banco de teste e a
       * Meta falsa. Não tem porta: o Playwright espera a linha que ele escreve ao
       * subir. `DISPATCH_TICK_SECONDS` faz o despachante varrer a cada 2 s, e não só
       * na volta do cron de um minuto; fora de NODE_ENV=test a variável impede o
       * processo de subir.
       *
       * O pg-boss dele usa o esquema padrão; o Jest usa `pgboss_jest`. Assim um não
       * pega as tarefas do outro no mesmo banco.
       */
      command: "npm run start:worker -w @repo/api",
      wait: { stdout: /worker de pé/ },
      reuseExistingServer: false,
      env: {
        NODE_ENV: "test",
        DATABASE_URL: TEST_DATABASE_URL,
        META_AUTH_URL: `http://127.0.0.1:${FAKE_META_PORT}`,
        META_TOKEN_URL: `http://127.0.0.1:${FAKE_META_PORT}`,
        META_GRAPH_URL: `http://127.0.0.1:${FAKE_META_PORT}`,
        DISPATCH_TICK_SECONDS: "2",
      },
    },
  ],
});
