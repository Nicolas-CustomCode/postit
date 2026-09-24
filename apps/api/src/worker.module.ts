import { DynamicModule, Module } from "@nestjs/common";
import type { WorkerEnv } from "./config/env";
import { MaintenanceModule } from "./maintenance/maintenance.module";
import { PrismaModule } from "./prisma/prisma.module";
import { PublishingModule } from "./publishing/publishing.module";
import { QueuesModule } from "./queues/queues.module";
import { StorageModule } from "./storage/storage.module";

/**
 * Módulos do processo worker. É o ÚNICO lugar que importa PublishingModule e
 * QueuesModule (invariante I-9), e o `architecture.spec.ts` confere que o
 * processo HTTP não os alcança.
 *
 * A ordem não é decorativa: o `QueuesModule` inicia o pg-boss, e o
 * `PublishingModule` registra os tratadores em cima dele. Como o
 * `TokenRefreshWorker` injeta o `BossService`, o Nest resolve a dependência
 * antes de chamar o `onModuleInit` dele.
 */
@Module({})
export class WorkerModule {
  static forEnv(env: WorkerEnv): DynamicModule {
    return {
      module: WorkerModule,
      imports: [
        PrismaModule.forUrl(env.DATABASE_URL),
        StorageModule.forEnv(env),
        QueuesModule.forEnv(env),
        PublishingModule.forEnv(env),
        MaintenanceModule,
      ],
    };
  }
}
