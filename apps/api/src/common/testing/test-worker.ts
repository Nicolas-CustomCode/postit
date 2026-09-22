import "reflect-metadata";
import { Module, type DynamicModule, type INestApplicationContext, type LoggerService } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import type { PrismaClient } from "@repo/database";
import type { PgBoss } from "pg-boss";
import { readWorkerEnv } from "../../config/env";
import { InstagramModule } from "../../instagram/instagram.module";
import { INSTAGRAM_CONFIG, type InstagramConfig } from "../../instagram/instagram.config";
import { PrismaModule } from "../../prisma/prisma.module";
import { PrismaService } from "../../prisma/prisma.service";
import { DeadLetterService } from "../../publishing/instagram/dead-letter.service";
import { DispatcherService } from "../../publishing/instagram/dispatcher.service";
import { PublisherService } from "../../publishing/instagram/publisher.service";
import {
  DEFAULT_PUBLISHING_CONFIG,
  PUBLISHING_CONFIG,
  type PublishingConfig,
} from "../../publishing/instagram/publishing.config";
import { PUBLISHING_SERVICES } from "../../publishing/publishing.module";
import { BossService } from "../../queues/boss.service";
import { QueuesModule } from "../../queues/queues.module";
import { StorageModule } from "../../storage/storage.module";
import { resetAuthTables } from "./reset-database";
import { testDatabaseUrl } from "./test-database";

/**
 * O motor de publicação montado para os testes de integração — os mesmos serviços
 * do worker, **sem os tratadores de fila**: o teste chama o despachante e o
 * publicador quando quer, e nenhum tratador do pg-boss pega a tarefa no meio.
 *
 * O pg-boss usa um esquema próprio (`pgboss_jest`): um worker do e2e ligado no
 * mesmo banco de teste não enxerga estas tarefas, nem estas as dele.
 *
 * Os tempos do motor caem para milissegundos — sem relógio falso, que trava o
 * driver do Postgres.
 */
export const TEST_BOSS_SCHEMA = "pgboss_jest";

export interface TestWorker {
  readonly context: INestApplicationContext;
  readonly db: PrismaClient;
  readonly boss: PgBoss;
  readonly encryptionKey: Buffer;
  readonly dispatcher: DispatcherService;
  readonly publisher: PublisherService;
  readonly deadLetter: DeadLetterService;
  /** Tudo o que o motor escreveu no log — para provar que o token nunca aparece. */
  readonly logs: string[];
  reset(): Promise<void>;
  close(): Promise<void>;
}

@Module({})
class TestWorkerModule {}

export async function bootTestWorker(
  overrides: NodeJS.ProcessEnv = {},
  publishing: Partial<PublishingConfig> = {},
): Promise<TestWorker> {
  const env = readWorkerEnv({ ...process.env, NODE_ENV: "test", DATABASE_URL: testDatabaseUrl(), ...overrides });

  const definition: DynamicModule = {
    module: TestWorkerModule,
    imports: [
      PrismaModule.forUrl(env.DATABASE_URL),
      StorageModule.forEnv(env),
      QueuesModule.forEnv(env, { schema: TEST_BOSS_SCHEMA }),
      InstagramModule.forEnv(env),
    ],
    providers: [
      {
        provide: PUBLISHING_CONFIG,
        useValue: {
          ...DEFAULT_PUBLISHING_CONFIG,
          statusPollIntervalMs: 5,
          reconcileWaitMs: 5,
          ...publishing,
        } satisfies PublishingConfig,
      },
      ...PUBLISHING_SERVICES,
    ],
  };

  const logs: string[] = [];
  const context = await NestFactory.createApplicationContext(definition, { logger: captureLogger(logs) });

  const db = context.get(PrismaService).db;
  const boss = context.get(BossService).boss;

  return {
    context,
    db,
    boss,
    encryptionKey: context.get<InstagramConfig>(INSTAGRAM_CONFIG).encryptionKey,
    dispatcher: context.get(DispatcherService),
    publisher: context.get(PublisherService),
    deadLetter: context.get(DeadLetterService),
    logs,
    async reset() {
      await resetAuthTables(db);
      await boss.deleteAllJobs();
      logs.length = 0;
    },
    close: () => context.close(),
  };
}

/** Um logger que guarda cada linha, com o contexto, em vez de imprimir. */
function captureLogger(logs: string[]): LoggerService {
  const push = (message: unknown, ...rest: unknown[]) => logs.push([message, ...rest].map(String).join(" "));
  return { log: push, warn: push, error: push, debug: push, verbose: push, fatal: push };
}
