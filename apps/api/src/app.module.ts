import { DynamicModule, Module } from "@nestjs/common";
import { APP_GUARD } from "@nestjs/core";
import type { ApiEnv } from "./config/env";
import { InternalKeyGuard } from "./common/guards/internal-key.guard";
import { HealthController } from "./health/health.controller";
import { PrismaModule } from "./prisma/prisma.module";

/**
 * Módulos do processo HTTP.
 *
 * NUNCA importar aqui PublishingModule nem QueuesModule: só o worker publica
 * (invariante I-9). Um teste de arquitetura vai conferir isso (Fase 0, Bloco B).
 */
@Module({})
export class AppModule {
  static forEnv(env: ApiEnv): DynamicModule {
    return {
      module: AppModule,
      imports: [PrismaModule.forUrl(env.DATABASE_URL)],
      controllers: [HealthController],
      providers: [
        // Guarda global: nenhuma rota escapa da chave interna.
        { provide: APP_GUARD, useFactory: () => new InternalKeyGuard(env.INTERNAL_API_KEY) },
      ],
    };
  }
}
