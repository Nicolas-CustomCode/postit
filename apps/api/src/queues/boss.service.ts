import { Injectable, Logger, type OnModuleDestroy, type OnModuleInit } from "@nestjs/common";
import { PgBoss } from "pg-boss";
import {
  ACCOUNT_METRICS_CRON,
  ACCOUNT_METRICS_QUEUE,
  MAINTENANCE_CRON,
  MAINTENANCE_QUEUE,
  TOKEN_REFRESH_CRON,
  TOKEN_REFRESH_QUEUE,
} from "./queue-names";
import { QUEUE_DEFINITIONS } from "./queue-definitions";

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

  /**
   * `schema` só existe para os testes: o Jest usa um esquema próprio, e assim um
   * worker do e2e rodando no mesmo banco não pega as tarefas dele.
   */
  constructor(databaseUrl: string, options: { schema?: string } = {}) {
    this.boss = new PgBoss({ connectionString: databaseUrl, ...options });

    // Sem isto, um erro interno do pg-boss derruba o processo: o EventEmitter do
    // Node lança quando ninguém escuta 'error'. O worker precisa continuar de pé
    // e tentar de novo, não morrer porque o banco piscou.
    this.boss.on("error", (error) => {
      this.logger.error(`Erro interno da fila: ${error instanceof Error ? error.name : "desconhecido"}`);
    });
  }

  async onModuleInit(): Promise<void> {
    await this.boss.start();
    await this.prepareQueues();

    await this.boss.schedule(TOKEN_REFRESH_QUEUE, TOKEN_REFRESH_CRON);
    await this.boss.schedule(ACCOUNT_METRICS_QUEUE, ACCOUNT_METRICS_CRON);
    await this.boss.schedule(MAINTENANCE_QUEUE, MAINTENANCE_CRON);

    this.logger.log(
      `${QUEUE_DEFINITIONS.length} filas prontas. Recorrentes: ${TOKEN_REFRESH_QUEUE} (${TOKEN_REFRESH_CRON} UTC), ` +
        `${ACCOUNT_METRICS_QUEUE} (${ACCOUNT_METRICS_CRON} UTC), ${MAINTENANCE_QUEUE} (${MAINTENANCE_CRON} UTC).`,
    );
  }

  /**
   * Cria as filas que faltam e alinha as que já existem com `QUEUE_DEFINITIONS`.
   *
   * Os dois passos são necessários: `createQueue` não mexe em fila existente, então
   * uma retentativa mudada no código nunca chegaria ao banco sem o `updateQueue`.
   *
   * A política é a exceção — o pg-boss não a muda depois de criada. Uma fila de
   * publicação que tenha nascido `standard` aceitaria duas tarefas da mesma
   * postagem, e por isso o worker se recusa a subir com ela: é melhor parar no
   * boot do que publicar duas vezes. O conserto é apagar a fila vazia com
   * `deleteQueue` e deixar este método recriá-la.
   */
  private async prepareQueues(): Promise<void> {
    for (const { name, policy = "standard", ...options } of QUEUE_DEFINITIONS) {
      await this.boss.createQueue(name, { policy, ...options });
      await this.boss.updateQueue(name, options);

      const existing = await this.boss.getQueue(name);
      const actual = existing?.policy ?? "standard";
      if (actual !== policy) {
        throw new Error(`A fila ${name} está com a política ${actual}, e o código exige ${policy}.`);
      }
    }
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
