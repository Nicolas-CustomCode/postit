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

  // Até as filas do pg-boss existirem (Fase 0, Bloco C), nada segura o processo
  // aberto: ele sairia logo depois de subir, e o Easypanel e o PM2 o
  // reiniciariam sem parar. Sai junto com a primeira fila. O sinal de parada
  // continua encerrando normalmente, pelos shutdown hooks.
  setInterval(() => undefined, 60 * 60 * 1000);
}

bootstrap().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
