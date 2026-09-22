import { Injectable, Logger } from "@nestjs/common";
import { fromPrisma } from "pg-boss";
import { dispatchDecision, quotaAllows } from "../../domain/publishing/dispatch";
import { dispatchHorizon } from "../../domain/publishing/lateness";
import { PrismaService } from "../../prisma/prisma.service";
import { BossService } from "../../queues/boss.service";
import { PUBLISH_QUEUE } from "../../queues/queue-names";
import { PostOutcomeStore } from "./post-outcome.store";
import { PublishFailureService } from "./publish-failure.service";
import { recordPublishEvent } from "./publish-events";

/** O que vai na tarefa de publicação. A versão diz de que ciclo ela é. */
export interface PublishJobData {
  readonly postId: string;
  readonly version: number;
}

export interface DispatchReport {
  readonly dispatched: number;
  readonly deferred: number;
  readonly failed: number;
  /** Postagens `PROCESSANDO` sem ninguém cuidando, que ganharam tarefa de novo. */
  readonly requeued: number;
}

/** Quantas postagens uma varredura olha. Sobra vai na próxima, em um minuto. */
const SWEEP_LIMIT = 200;
const DAY_MS = 24 * 60 * 60_000;

/** A duplicata que o pg-boss recusou: a transação precisa ser desfeita. */
class DispatchConflict extends Error {
  override readonly name = "DispatchConflict";
}

/**
 * O despachante (docs/09): a cada minuto, entrega ao publicador as postagens cujo
 * horário chegou. A agenda mora na tabela `Postagem`; o pg-boss só entra quando é
 * hora de executar.
 */
@Injectable()
export class DispatcherService {
  private readonly logger = new Logger("Despachante");

  constructor(
    private readonly prisma: PrismaService,
    private readonly queues: BossService,
    private readonly store: PostOutcomeStore,
    private readonly failures: PublishFailureService,
  ) {}

  async dispatchDue(now: Date = new Date()): Promise<DispatchReport> {
    const due = await this.prisma.db.post.findMany({
      where: { status: "SCHEDULED", scheduledAt: { lte: dispatchHorizon(now) } },
      select: { id: true, accountId: true, scheduledAt: true, version: true, lastErrorCode: true },
      orderBy: { scheduledAt: "asc" },
      take: SWEEP_LIMIT,
    });

    const report = { dispatched: 0, deferred: 0, failed: 0, requeued: 0 };
    const used = new Map<string, number>();

    for (const post of due) {
      if (post.scheduledAt === null) continue;

      // Uma postagem que dá errado não segura as outras da mesma varredura.
      try {
        if (!used.has(post.accountId)) used.set(post.accountId, await this.quotaUsed(post.accountId, now));

        const decision = dispatchDecision({
          scheduledAt: post.scheduledAt,
          now,
          quotaAvailable: quotaAllows(used.get(post.accountId) ?? 0),
          deferredForQuota: post.lastErrorCode === "QUOTA_DEFERRED",
        });

        if (decision.kind === "FAIL") {
          const ok = await this.failures.fail({
            postId: post.id,
            cause: decision.cause,
            step: "DISPATCH",
            fence: { status: "SCHEDULED", version: post.version },
          });
          if (ok) report.failed += 1;
        } else if (decision.kind === "DEFER") {
          // Registra o adiamento uma vez, não a cada minuto em que a cota falta.
          if (await this.store.defer(post.id, post.version)) {
            await recordPublishEvent(this.prisma.db, {
              postId: post.id,
              step: "DISPATCH",
              result: "RECOVERABLE_ERROR",
              metaResponse: { cause: "QUOTA_DEFERRED" },
            });
          }
          report.deferred += 1;
        } else if (await this.dispatch(post.id, post.version, post.scheduledAt)) {
          used.set(post.accountId, (used.get(post.accountId) ?? 0) + 1);
          report.dispatched += 1;
        }
      } catch (error) {
        this.logger.error(`Não despachei a postagem ${post.id}: ${error instanceof Error ? error.name : "erro"}.`);
      }
    }

    report.requeued = await this.requeueOrphans(now);

    if (report.dispatched + report.deferred + report.failed + report.requeued > 0) {
      this.logger.log(
        `Varredura: ${report.dispatched} despachadas, ${report.deferred} adiadas por cota, ` +
          `${report.failed} para FALHOU, ${report.requeued} recolhidas.`,
      );
    }
    return report;
  }

  /**
   * `AGENDADO → PROCESSANDO` e a tarefa, **na mesma transação** (camadas 1 e 3 de
   * idempotência; AGENTS.md, regra 8). Se a transação desfaz, a tarefa some junto.
   *
   * O pg-boss recusa a duplicata devolvendo `null`, sem lançar — e sem lançar a
   * transação confirmaria a postagem marcada sem tarefa. Por isso o `throw`.
   */
  private async dispatch(postId: string, version: number, scheduledAt: Date): Promise<boolean> {
    try {
      return await this.prisma.db.$transaction(async (tx) => {
        if (!(await this.store.dispatch(tx, postId, version))) return false;

        const data: PublishJobData = { postId, version };
        const jobId = await this.queues.boss.send(PUBLISH_QUEUE, data, {
          singletonKey: postId,
          startAfter: scheduledAt,
          db: fromPrisma(tx),
        });
        if (jobId === null) throw new DispatchConflict();

        await recordPublishEvent(tx, { postId, step: "DISPATCH", result: "SUCCESS" });
        return true;
      });
    } catch (error) {
      if (!(error instanceof DispatchConflict)) throw error;
      // Uma tarefa antiga desta postagem ainda ocupa a vaga; a próxima volta tenta.
      this.logger.warn(`A postagem ${postId} ainda tem tarefa na fila; fica para a próxima varredura.`);
      return false;
    }
  }

  /**
   * Quanto da cota a conta já usou: as publicações das últimas 24 horas **e** as em
   * processamento, que vão consumir cota em instantes (RNF-04).
   */
  private async quotaUsed(accountId: string, now: Date): Promise<number> {
    const [published, processing] = await Promise.all([
      this.prisma.db.publication.count({
        where: { post: { accountId }, publishedAt: { gte: new Date(now.getTime() - DAY_MS) } },
      }),
      this.prisma.db.post.count({ where: { accountId, status: "PROCESSING" } }),
    ]);
    return published + processing;
  }

  /**
   * Recolhe as postagens `PROCESSANDO` que ficaram sem ninguém: nenhuma execução
   * segura o arrendamento e nenhuma tarefa viva as espera.
   *
   * É a rede de segurança do motor. O pg-boss não distingue a execução antiga da
   * retentativa — as duas têm o mesmo id de tarefa —, então há desfechos em que a
   * tarefa termina e a postagem fica no meio: uma execução que caiu na última
   * tentativa com o arrendamento ainda válido, ou uma que saiu quieta porque outra
   * a segurava e essa outra caiu depois. Sem isto, elas ficariam `PROCESSANDO` para
   * sempre.
   *
   * Mandar de novo é seguro: numa fila `exclusive`, se ainda houver tarefa viva, o
   * pg-boss devolve `null` e nada acontece. O limite de tentativas é nosso
   * (`tentativas`, no publicador), então recolher não cria tentativa infinita.
   */
  private async requeueOrphans(now: Date): Promise<number> {
    const orphans = await this.prisma.db.post.findMany({
      where: { status: "PROCESSING", OR: [{ runLeaseUntil: null }, { runLeaseUntil: { lt: now } }] },
      select: { id: true, version: true },
      take: SWEEP_LIMIT,
    });

    let requeued = 0;
    for (const orphan of orphans) {
      const data: PublishJobData = { postId: orphan.id, version: orphan.version };
      const jobId = await this.queues.boss.send(PUBLISH_QUEUE, data, { singletonKey: orphan.id });
      if (jobId !== null) {
        requeued += 1;
        this.logger.warn(`A postagem ${orphan.id} estava PROCESSANDO sem ninguém; ganhou tarefa de novo.`);
      }
    }
    return requeued;
  }
}
