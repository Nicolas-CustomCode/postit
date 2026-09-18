import { Injectable, Logger, type OnModuleDestroy, type OnModuleInit } from "@nestjs/common";
import { PgBoss } from "pg-boss";
import {
  ACCOUNT_METRICS_CRON,
  ACCOUNT_METRICS_QUEUE,
  TOKEN_REFRESH_CRON,
  TOKEN_REFRESH_QUEUE,
} from "./queue-names";

/**
 * A instância do pg-boss do processo worker (docs/09, "O worker").
 *
 * ⚠️ **Só o worker.** Este módulo e o `PublishingModule` são importados apenas
 * pelo `WorkerModule` (AGENTS.md, regra 1; invariante I-9), e o
 * `architecture.spec.ts` confere que o processo HTTP não os alcança.
 *
 * As filas nascem aqui, ao iniciar, porque o pg-boss exige que a fila exista
 * antes de receber tarefa. Os agendamentos recorrentes também: registrá-los é
 * idempotente, então repetir a cada boot não duplica nada.
 *
 * O esquema `pgboss` é criado e migrado pelo próprio pg-boss na primeira vez que
 * o worker sobe. Ele **não** está no `schema.prisma` e nenhuma migração do
 * Prisma o toca (docs/07, "O esquema do pg-boss").
 */
@Injectable()
export class BossService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger("Filas");
  readonly boss: PgBoss;

  constructor(databaseUrl: string) {
    this.boss = new PgBoss(databaseUrl);

    // Sem isto, um erro interno do pg-boss derruba o processo: o EventEmitter do
    // Node lança quando ninguém escuta 'error'. O worker precisa continuar de pé
    // e tentar de novo, não morrer porque o banco piscou.
    this.boss.on("error", (error) => {
      this.logger.error(`Erro interno da fila: ${error instanceof Error ? error.name : "desconhecido"}`);
    });
  }

  async onModuleInit(): Promise<void> {
    await this.boss.start();

    /*
     * 3 tentativas no total (docs/09, tabela das filas): a execução original
     * mais duas repetições.
     *
     * `retryBackoff` não é detalhe: a causa mais provável de falha nas duas é a
     * Meta recusando por limite de uso, e repetir logo em seguida bateria no
     * mesmo limite. Com a espera dobrando, a segunda tentativa cai num momento
     * diferente.
     */
    const opcoes = { retryLimit: 2, retryBackoff: true };

    await this.boss.createQueue(TOKEN_REFRESH_QUEUE, opcoes);
    await this.boss.schedule(TOKEN_REFRESH_QUEUE, TOKEN_REFRESH_CRON);

    await this.boss.createQueue(ACCOUNT_METRICS_QUEUE, opcoes);
    await this.boss.schedule(ACCOUNT_METRICS_QUEUE, ACCOUNT_METRICS_CRON);

    this.logger.log(
      `Filas prontas: ${TOKEN_REFRESH_QUEUE} (${TOKEN_REFRESH_CRON} UTC), ` +
        `${ACCOUNT_METRICS_QUEUE} (${ACCOUNT_METRICS_CRON} UTC).`,
    );
  }

  /**
   * Termina a tarefa em andamento antes de sair.
   *
   * Chega pelo `enableShutdownHooks` no SIGTERM do Easypanel ou do PM2. O
   * `kill_timeout` é de 60 s justamente para caber uma chamada à Meta aqui
   * (docs/10) — o padrão de 1,6 s do PM2 mataria no meio.
   */
  async onModuleDestroy(): Promise<void> {
    await this.boss.stop();
  }
}
