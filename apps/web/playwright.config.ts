import { defineConfig, devices } from "@playwright/test";

/**
 * Testes de tela (docs/15, "Playwright"): `npm run test:e2e`.
 *
 * Rodam contra o build de produção (`next start`), e não contra o `next dev`: a
 * CSP de produção é mais estrita, e é ela que precisa passar. Por isso a porta é
 * própria, 3100 — um `npm run dev` aberto na 3010 não é reaproveitado por engano.
 * Antes, `npm run build`.
 *
 * Dois tamanhos de tela, porque o PostIt funciona por completo nos dois. O
 * celular é um Pixel, que usa o mesmo Chromium: um navegador só para instalar
 * na CI.
 */
const WEB_PORT = 3100;
const FAKE_META_PORT = 3199;

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
      env: { PORT: String(WEB_PORT), APP_URL: `http://localhost:${WEB_PORT}` },
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
