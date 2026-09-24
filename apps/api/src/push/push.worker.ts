import { Inject, Injectable, Logger, type OnModuleDestroy, type OnModuleInit } from "@nestjs/common";
import { BossService } from "../queues/boss.service";
import { NOTIFY_QUEUE } from "../queues/queue-names";
import { PUSH_CONFIG, type PushConfig } from "./push.config";
import { PushDeliveryService, type NotifyJobData } from "./push-delivery.service";

/**
 * Liga o push ao worker: a varredura a cada poucos segundos e a fila `notificar`.
 *
 * Sem as chaves VAPID, não liga nada e diz isso no log. As entregas ficam com
 * `pushEnviadoEm` nulo, e quando o push for ligado a varredura marca as de mais de
 * uma hora sem enviar — ninguém recebe de uma vez os avisos da semana.
 *
 * Varredura por `setInterval`, e não por cron do pg-boss: o cron tem resolução de
 * um minuto, e o push existe para chegar logo.
 */
@Injectable()
export class PushWorker implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger("Push");
  private tick: NodeJS.Timeout | null = null;

  constructor(
    private readonly queues: BossService,
    private readonly delivery: PushDeliveryService,
    @Inject(PUSH_CONFIG) private readonly config: PushConfig,
  ) {}

  async onModuleInit(): Promise<void> {
    if (this.config.vapid === null) {
      this.logger.warn("Push desligado: faltam as chaves VAPID. O sino continua recebendo tudo.");
      return;
    }

    await this.queues.boss.work<NotifyJobData>(NOTIFY_QUEUE, async ([job]) => {
      if (job) await this.delivery.deliver(job.data, new Date());
    });

    this.tick = setInterval(() => {
      this.delivery.sweep(new Date()).catch((error: unknown) => {
        this.logger.error(`A varredura do push falhou: ${error instanceof Error ? error.name : "erro desconhecido"}`);
      });
    }, this.config.sweepMs);

    this.logger.log(`Ouvindo a fila ${NOTIFY_QUEUE}; varredura a cada ${this.config.sweepMs / 1000} s.`);
  }

  onModuleDestroy(): void {
    if (this.tick !== null) clearInterval(this.tick);
  }
}
