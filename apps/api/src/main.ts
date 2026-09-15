import "reflect-metadata";
import { readApiEnv } from "./config/env";
import { createApp } from "./create-app";

/**
 * Processo HTTP da API (postit-api). Só o Next o alcança: escuta em API_HOST —
 * 127.0.0.1 na etapa 2, 0.0.0.0 dentro do container sem domínio na etapa 1.
 */
async function bootstrap(): Promise<void> {
  const env = readApiEnv();
  const app = await createApp(env);
  await app.listen(env.API_PORT, env.API_HOST);
}

bootstrap().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
