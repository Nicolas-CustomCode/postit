import { Injectable, Logger, type OnModuleInit } from "@nestjs/common";
import { InstagramUnavailableError } from "../../common/errors";
import { InstagramAccountMetricsService } from "../../instagram/account-metrics.service";
import { BossService } from "../../queues/boss.service";
import { ACCOUNT_METRICS_QUEUE } from "../../queues/queue-names";

/**
 * Liga a fila `coletar-metricas-conta-instagram` ao serviço que faz o trabalho.
 *
 * Só a ponta: a regra mora no `InstagramAccountMetricsService`, no
 * `InstagramModule`, porque o comando `admin:collect-metrics` chama o mesmo
 * método e o CLI não pode importar `publishing/` (AGENTS.md, regra 1).
 *
 * **Falha de coleta nunca vira alarme** (docs/09): o conteúdo já está publicado,
 * o número é secundário, e os 3 dias de sobreposição cobrem um dia perdido. Por
 * isso só a falha recuperável sobe — e ela sobe apenas para o pg-boss reagendar,
 * sem notificar ninguém.
 */
@Injectable()
export class AccountMetricsWorker implements OnModuleInit {
  private readonly logger = new Logger("Filas");

  constructor(
    private readonly queues: BossService,
    private readonly metrics: InstagramAccountMetricsService,
  ) {}

  async onModuleInit(): Promise<void> {
    await this.queues.boss.work(ACCOUNT_METRICS_QUEUE, async () => {
      const resultado = await this.metrics.collectDue(new Date());

      if (resultado.recoverable > 0) {
        throw new InstagramUnavailableError();
      }
    });

    this.logger.log(`Ouvindo a fila ${ACCOUNT_METRICS_QUEUE}.`);
  }
}
