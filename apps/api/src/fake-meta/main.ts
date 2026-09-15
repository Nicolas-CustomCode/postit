/**
 * Sobe a Meta falsa para os testes de tela: `npm run fake-meta -w @repo/api`.
 * Quem chama é o Playwright (apps/web/playwright.config.ts), com NODE_ENV=test.
 */
import { createFakeMeta } from "./fake-meta";

async function bootstrap(): Promise<void> {
  const app = createFakeMeta(process.env["NODE_ENV"]);
  const port = Number(process.env["FAKE_META_PORT"] ?? 3199);
  await app.listen({ port, host: "127.0.0.1" });
}

void bootstrap().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
