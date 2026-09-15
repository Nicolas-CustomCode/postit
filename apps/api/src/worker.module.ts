import { DynamicModule, Module } from "@nestjs/common";
import type { WorkerEnv } from "./config/env";
import { PrismaModule } from "./prisma/prisma.module";

/**
 * Módulos do processo worker. É o ÚNICO lugar que vai importar PublishingModule e
 * QueuesModule (invariante I-9). O pg-boss entra no Bloco C da Fase 0.
 */
@Module({})
export class WorkerModule {
  static forEnv(env: WorkerEnv): DynamicModule {
    return {
      module: WorkerModule,
      imports: [PrismaModule.forUrl(env.DATABASE_URL)],
    };
  }
}
