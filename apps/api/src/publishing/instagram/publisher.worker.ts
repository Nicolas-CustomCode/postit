import { Injectable, Logger, type OnModuleInit } from "@nestjs/common";
import { BossService } from "../../queues/boss.service";
import { PUBLISH_DEAD_LETTER_QUEUE, PUBLISH_QUEUE } from "../../queues/queue-names";
import { DeadLetterService } from "./dead-letter.service";
import type { PublishJobData } from "./dispatcher.service";
import { PublisherService } from "./publisher.service";

/**
 * Tratadores simultâneos por worker. Com um só, um carrossel esperando o preparo
 * da Meta por minutos seguraria todas as postagens do mesmo minuto.
 */
const PUBLISH_CONCURRENCY = 3;

/** Liga `publicar-instagram` ao publicador e `publicar-instagram-falhas` ao tratador. */
@Injectable()
export class PublisherWorker implements OnModuleInit {
  private readonly logger = new Logger("Filas");

  constructor(
    private readonly queues: BossService,
    private readonly publisher: PublisherService,
    private readonly deadLetter: DeadLetterService,
  ) {}

  async onModuleInit(): Promise<void> {
    // O `signal` é como o pg-boss avisa que desistiu desta execução — prazo vencido
    // ou desligamento. O publicador para antes da próxima chamada à Meta.
    await this.queues.boss.work<PublishJobData>(
      PUBLISH_QUEUE,
      { localConcurrency: PUBLISH_CONCURRENCY },
      async ([job]) => {
        if (job) await this.publisher.run(job.data, job.signal);
      },
    );

    await this.queues.boss.work<PublishJobData>(PUBLISH_DEAD_LETTER_QUEUE, async ([job]) => {
      if (job) await this.deadLetter.run(job.data);
    });

    this.logger.log(`Ouvindo as filas ${PUBLISH_QUEUE} e ${PUBLISH_DEAD_LETTER_QUEUE}.`);
  }
}
