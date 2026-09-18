import { Global, Module, type DynamicModule } from "@nestjs/common";
import type { WorkerEnv } from "../config/env";
import { BossService } from "./boss.service";

/**
 * As filas do pg-boss. Importado **só** pelo `WorkerModule` (AGENTS.md, regra 1).
 *
 * Recebe `WorkerEnv`, e não `ApiEnv | WorkerEnv` como os módulos compartilhados:
 * o tipo é a primeira barreira contra alguém pendurar isto no processo HTTP.
 *
 * Global pelo mesmo motivo do `PrismaModule`: há **uma** instância do pg-boss
 * por processo. Se cada módulo que precisa de fila importasse este, cada um
 * ganharia a sua — duas conexões, dois conjuntos de tratadores e cada tarefa
 * executada duas vezes.
 */
@Global()
@Module({})
export class QueuesModule {
  static forEnv(env: WorkerEnv): DynamicModule {
    return {
      module: QueuesModule,
      providers: [{ provide: BossService, useFactory: () => new BossService(env.DATABASE_URL) }],
      exports: [BossService],
    };
  }
}
