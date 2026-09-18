import { Module, type DynamicModule } from "@nestjs/common";
import type { WorkerEnv } from "../config/env";
import { InstagramModule } from "../instagram/instagram.module";
import { AccountMetricsWorker } from "./instagram/metrics.worker";
import { TokenRefreshWorker } from "./instagram/token-refresh.worker";

/**
 * Quem faz o trabalho de fundo: despachante, publicador, coletor de métricas e
 * renovador de tokens (docs/09). Importado **só** pelo `WorkerModule`
 * (AGENTS.md, regra 1) — nesta fase, só a renovação de tokens existe.
 *
 * É daqui que sai o `InstagramModule` do processo worker, e não do
 * `WorkerModule`: `forEnv` devolve um módulo novo a cada chamada, então importar
 * nos dois lugares abriria dois de tudo que ele tem dentro. O `BossService` não
 * aparece nos imports pelo mesmo motivo invertido — o `QueuesModule` é global, e
 * o `WorkerModule` já o registrou.
 */
@Module({})
export class PublishingModule {
  static forEnv(env: WorkerEnv): DynamicModule {
    return {
      module: PublishingModule,
      imports: [InstagramModule.forEnv(env)],
      providers: [TokenRefreshWorker, AccountMetricsWorker],
    };
  }
}
