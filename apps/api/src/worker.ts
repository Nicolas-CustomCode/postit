import "reflect-metadata";
import { Logger } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import { VERSION } from "@repo/shared";
import { readWorkerEnv } from "./config/env";
import { WorkerModule } from "./worker.module";

/**
 * Processo worker (postit-worker): o mesmo código da API, sem HTTP.
 * Despacha, publica, coleta métricas, renova tokens e envia push. Só ele publica.
 */
async function bootstrap(): Promise<void> {
  const env = readWorkerEnv();
  const context = await NestFactory.createApplicationContext(WorkerModule.forEnv(env));
  // SIGTERM do PM2 ou do Easypanel fecha módulos e conexões antes de sair,
  // dando tempo à tarefa em andamento (docs/10, kill_timeout).
  context.enableShutdownHooks();
  new Logger("Worker").log(`PostIt ${VERSION} — worker de pé`);

  // Nada mais a fazer aqui: o pg-boss segura o processo aberto enquanto estiver
  // ouvindo as filas, e o sinal de parada o encerra pelos shutdown hooks.
}

bootstrap().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
