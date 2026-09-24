import { Injectable, Logger, type OnModuleInit } from "@nestjs/common";
import { OrphanDerivativesService } from "../media/orphan-derivatives.service";
import { BossService } from "../queues/boss.service";
import { MAINTENANCE_QUEUE } from "../queues/queue-names";

/**
 * Liga a fila `manutencao` ao que ela faz (docs/09).
 *
 * É só a ponta: a regra de quem é órfã mora no `OrphanDerivativesService`. Hoje a
 * faxina é uma coisa só — as imagens recortadas que ninguém usa —; o docs/09 lista o
 * que mais vem para cá.
 *
 * **Não repete.** A fila tem uma tentativa: o que sobrar hoje a faxina de amanhã
 * pega, e um erro inesperado lança para ficar registrado no pg-boss.
 */
@Injectable()
export class MaintenanceWorker implements OnModuleInit {
  private readonly logger = new Logger("Filas");

  constructor(
    private readonly queues: BossService,
    private readonly orphans: OrphanDerivativesService,
  ) {}

  async onModuleInit(): Promise<void> {
    // A tarefa não carrega dado nenhum: ela mesma descobre o que limpar.
    await this.queues.boss.work(MAINTENANCE_QUEUE, async () => {
      await this.orphans.sweep(new Date());
    });

    this.logger.log(`Ouvindo a fila ${MAINTENANCE_QUEUE}.`);
  }
}
