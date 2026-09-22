import { Module, type DynamicModule, type Provider } from "@nestjs/common";
import type { WorkerEnv } from "../config/env";
import { InstagramModule } from "../instagram/instagram.module";
import { InstagramPublishingApi } from "../instagram/publishing";
import { DeadLetterService } from "./instagram/dead-letter.service";
import { DispatchWorker } from "./instagram/dispatch.worker";
import { DispatcherService } from "./instagram/dispatcher.service";
import { AccountMetricsWorker } from "./instagram/metrics.worker";
import { PostOutcomeStore } from "./instagram/post-outcome.store";
import { PublishFailureService } from "./instagram/publish-failure.service";
import { PublisherService } from "./instagram/publisher.service";
import { PublisherWorker } from "./instagram/publisher.worker";
import { DEFAULT_PUBLISHING_CONFIG, PUBLISHING_CONFIG } from "./instagram/publishing.config";
import { TokenRefreshWorker } from "./instagram/token-refresh.worker";

/**
 * O motor sem os tratadores de fila: quem faz o trabalho, mas não quem ouve as
 * filas. Separado para o teste de integração montar o motor e chamar os serviços
 * direto, sem um tratador do pg-boss pegando as tarefas no meio do teste.
 *
 * O `InstagramPublishingApi` mora aqui, e não no `InstagramModule`: só o worker
 * pode ter as chamadas de publicação (AGENTS.md, regra 1).
 */
export const PUBLISHING_SERVICES: Provider[] = [
  InstagramPublishingApi,
  PostOutcomeStore,
  PublishFailureService,
  DispatcherService,
  PublisherService,
  DeadLetterService,
];

/**
 * Quem faz o trabalho de fundo: despachante, publicador, tratador de falhas,
 * coletor de métricas e renovador de tokens (docs/09). Importado **só** pelo
 * `WorkerModule` (AGENTS.md, regra 1).
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
      providers: [
        {
          provide: PUBLISHING_CONFIG,
          useValue: {
            ...DEFAULT_PUBLISHING_CONFIG,
            dispatchTickMs: env.DISPATCH_TICK_SECONDS === undefined ? null : env.DISPATCH_TICK_SECONDS * 1000,
          },
        },
        ...PUBLISHING_SERVICES,
        TokenRefreshWorker,
        AccountMetricsWorker,
        DispatchWorker,
        PublisherWorker,
      ],
    };
  }
}
