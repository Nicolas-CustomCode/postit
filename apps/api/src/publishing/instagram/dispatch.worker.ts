import { Inject, Injectable, Logger, type OnModuleDestroy, type OnModuleInit } from "@nestjs/common";
import { BossService } from "../../queues/boss.service";
import { DISPATCH_CRON, DISPATCH_QUEUE } from "../../queues/queue-names";
import { DispatcherService } from "./dispatcher.service";
import { PUBLISHING_CONFIG, type PublishingConfig } from "./publishing.config";

/** Liga a fila recorrente `despachar` ao despachante. A regra toda mora no serviço. */
@Injectable()
export class DispatchWorker implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger("Filas");
  private tick: NodeJS.Timeout | null = null;

  constructor(
    private readonly queues: BossService,
    private readonly dispatcher: DispatcherService,
    @Inject(PUBLISHING_CONFIG) private readonly config: PublishingConfig,
  ) {}

  async onModuleInit(): Promise<void> {
    await this.queues.boss.work(DISPATCH_QUEUE, async () => {
      await this.dispatcher.dispatchDue();
    });
    await this.queues.boss.schedule(DISPATCH_QUEUE, DISPATCH_CRON);

    /*
     * Só nos testes de tela: uma varredura a cada poucos segundos, para o e2e não
     * esperar até 90 s pela volta do cron. Duas varreduras juntas são inofensivas —
     * a trava otimista decide quem despacha (camada 3).
     */
    if (this.config.dispatchTickMs !== null) {
      this.tick = setInterval(() => {
        this.dispatcher.dispatchDue().catch(() => undefined);
      }, this.config.dispatchTickMs);
    }

    this.logger.log(`Ouvindo a fila ${DISPATCH_QUEUE} (${DISPATCH_CRON} UTC).`);
  }

  onModuleDestroy(): void {
    if (this.tick !== null) clearInterval(this.tick);
  }
}
