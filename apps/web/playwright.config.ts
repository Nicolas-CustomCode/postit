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
 */
const WEB_PORT = 3100;
const API_PORT = 3111;
const FAKE_META_PORT = 3199;

const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL ?? "";

export default defineConfig({
  testDir: "e2e",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [["list"], ["html", { open: "never" }]] : "list",
  use: {
    baseURL: `http://localhost:${WEB_PORT}`,
    trace: "retain-on-failure",
  },
  projects: [
    { name: "computador", use: { ...devices["Desktop Chrome"] } },
    { name: "celular", use: { ...devices["Pixel 7"] } },
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
  ],
});
