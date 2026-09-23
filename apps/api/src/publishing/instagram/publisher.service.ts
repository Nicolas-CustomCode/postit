import { randomUUID } from "node:crypto";
import { Inject, Injectable, Logger } from "@nestjs/common";
import type { Prisma, PublishContainer } from "@repo/database";
import {
  isPublishFailureCause,
  postMediaCountProblem,
  PUBLISH_MAX_ATTEMPTS,
  type PostFormat,
  type PublishFailureCause,
} from "@repo/shared";
import { fromPrisma } from "pg-boss";
import { InstagramUnavailableError } from "../../common/errors";
import { decryptSecret } from "../../common/crypto";
import { classifyRefusal, classifyUnavailable, type PublishStepName } from "../../domain/publishing/classify";
import {
  CONTAINER_TTL_MS,
  containerPlan,
  isReusable,
  pollDecision,
  reconcile,
  type ContainerStatusCode,
} from "../../domain/publishing/container";
import { isPastCeiling, isTooLateToStart } from "../../domain/publishing/lateness";
import { metricMomentsFor } from "../../domain/publishing/metrics-schedule";
import { MetaRefusedError } from "../../instagram/client";
import { INSTAGRAM_CONFIG, type InstagramConfig } from "../../instagram/instagram.config";
import { InstagramPublishingApi } from "../../instagram/publishing";
import { PrismaService } from "../../prisma/prisma.service";
import { BossService } from "../../queues/boss.service";
import { POST_METRICS_QUEUE } from "../../queues/queue-names";
import { publicUrlFor } from "../../storage/public-url";
import { STORAGE_CONFIG, type StorageConfig } from "../../storage/storage.config";
import type { PublishJobData } from "./dispatcher.service";
import { PostOutcomeStore } from "./post-outcome.store";
import { PublishFailureService } from "./publish-failure.service";
import { recordPublishEvent, type PublishStepValue } from "./publish-events";
import { PUBLISHING_CONFIG, type PublishingConfig } from "./publishing.config";

/**
 * 5 execuções no total: a original e as 4 repetições da fila (queue-definitions).
 * A conta é nossa, em `tentativas`, porque o despachante pode recolher uma
 * postagem órfã e criar execução que o pg-boss não conta. O número mora no shared
 * porque a tela mostra "tentativa N de 5".
 */
export const MAX_PUBLISH_ATTEMPTS = PUBLISH_MAX_ATTEMPTS;

/**
 * Erro recuperável: o pg-boss agenda nova tentativa (docs/09, "a regra do jogo").
 * A mensagem é só a causa — ela vai parar na saída da tarefa, no banco.
 */
export class PublishRetryError extends Error {
  override readonly name = "PublishRetryError";
  constructor(readonly failure: PublishFailureCause) {
    super(`Nova tentativa: ${failure}`);
  }
}

/**
 * Esta execução não tem mais o que fazer: a postagem já foi decidida — publicada ou
 * `FALHOU` —, outra execução a tomou, ou o pg-boss mandou parar. Sai sem erro.
 */
class StopRun extends Error {
  override readonly name = "StopRun";
}

interface RunContext {
  readonly postId: string;
  readonly version: number;
  readonly runId: string;
  readonly signal: AbortSignal;
  readonly scheduledAt: Date;
}

interface PostToPublish extends RunContext {
  readonly accountId: string;
  readonly igUserId: string;
  readonly token: string;
  readonly format: PostFormat;
  readonly caption: string;
  readonly media: readonly { position: number; altText: string | null; url: string }[];
  readonly containers: PublishContainer[];
}

/**
 * O publicador (docs/09, "O publicador, passo a passo"): cria os containers na
 * Meta, espera ficarem prontos e publica — uma postagem por execução.
 *
 * O que ele garante, e onde:
 *
 * - **nunca duas vezes** — a `Publicacao` existente encerra (camada 2), o
 *   arrendamento deixa uma execução só falar com a Meta (I-6), e o registro da
 *   publicação é `ON CONFLICT DO NOTHING` sobre o índice único (camada 4);
 * - **nunca um container novo depois de pedir a publicação** — quem encontra
 *   `publicarPedidoEm` só reconcilia e, se for o caso, publica **o mesmo** container;
 * - **nunca atrasado demais** — 15 minutos para começar (I-8) e 45 para qualquer
 *   chamada nova (ADR 0007).
 */
@Injectable()
export class PublisherService {
  private readonly logger = new Logger("Publicacao");

  constructor(
    private readonly prisma: PrismaService,
    private readonly queues: BossService,
    private readonly api: InstagramPublishingApi,
    private readonly store: PostOutcomeStore,
    private readonly failures: PublishFailureService,
    @Inject(PUBLISHING_CONFIG) private readonly config: PublishingConfig,
    @Inject(INSTAGRAM_CONFIG) private readonly instagram: InstagramConfig,
    @Inject(STORAGE_CONFIG) private readonly storage: StorageConfig,
  ) {}

  async run(job: PublishJobData, signal: AbortSignal): Promise<void> {
    // Camada 2: já publicada. Se o status ficou para trás, acerta — a Publicacao é o fato.
    if (await this.repairIfPublished(job.postId)) return;

    const runId = randomUUID();
    const claim = await this.store.claimRun(job.postId, job.version, runId, this.config.leaseMs);
    if (claim === null) return;

    const ctx: RunContext = { postId: job.postId, version: job.version, runId, signal, scheduledAt: claim.scheduledAt };

    try {
      // I-8: a primeira execução não começa mais de 15 minutos depois do horário.
      if (claim.attempts === 1 && isTooLateToStart(claim.scheduledAt, new Date())) {
        await this.stop(ctx, "SYSTEM_UNAVAILABLE", "GIVE_UP");
      }
      if (claim.attempts > MAX_PUBLISH_ATTEMPTS) {
        const last = isPublishFailureCause(claim.lastErrorCode) ? claim.lastErrorCode : "SYSTEM_UNAVAILABLE";
        await this.stop(ctx, last, "GIVE_UP");
      }

      await this.attempt(await this.load(ctx));
    } catch (error) {
      if (error instanceof StopRun) return;
      if (error instanceof PublishRetryError) await this.store.releaseRun(ctx.postId, runId, error.failure);
      throw error;
    } finally {
      // Solta o arrendamento em qualquer saída; se a postagem já foi decidida, não há o que soltar.
      await this.store.releaseRun(ctx.postId, runId);
    }
  }

  private async attempt(post: PostToPublish): Promise<void> {
    /*
     * Pedido de publicação anterior: alguma execução chamou media_publish com este
     * container e não gravou o resultado. Antes de qualquer outra coisa, perguntar à
     * Meta o que aconteceu — e nunca criar outro container.
     */
    const requested = post.containers.find((c) => c.role !== "CHILD" && c.publishRequestedAt !== null);
    if (requested?.publishRequestedAt) {
      await this.reconcile(post, requested, requested.publishRequestedAt);
      await this.publish(post, requested);
      return;
    }

    const plan = containerPlan(post.media.length);
    const top = plan.kind === "SINGLE" ? await this.single(post) : await this.carousel(post);
    await this.publish(post, top);
  }

  private async single(post: PostToPublish): Promise<PublishContainer> {
    const media = post.media[0]!;
    const container =
      this.reusable(post, "SINGLE", null) ??
      (await this.create(post, "SINGLE", null, () =>
        this.api.createImageContainer(post.igUserId, post.token, {
          imageUrl: media.url,
          kind: post.format === "STORIES" ? "STORY" : "FEED",
          caption: post.caption,
          altText: media.altText,
        }),
      ));

    await this.waitReady(post, [container]);
    return container;
  }

  /**
   * Os filhos na ordem de `PostagemMidia.ordem` — a primeira define o recorte de
   * todas —, **todos criados antes de esperar**: esperar um a um levaria até 5
   * minutos por filho, e um carrossel de 10 passaria do prazo da tarefa.
   */
  private async carousel(post: PostToPublish): Promise<PublishContainer> {
    const children: PublishContainer[] = [];
    let createdChild = false;

    for (const media of post.media) {
      const existing = this.reusable(post, "CHILD", media.position);
      if (existing) {
        children.push(existing);
        continue;
      }
      createdChild = true;
      children.push(
        await this.create(post, "CHILD", media.position, () =>
          this.api.createImageContainer(post.igUserId, post.token, {
            imageUrl: media.url,
            kind: "CAROUSEL_ITEM",
            altText: media.altText,
          }),
        ),
      );
    }
    await this.waitReady(post, children);

    // O pai só serve se os filhos são os mesmos de quando ele nasceu.
    const parent =
      (createdChild ? null : this.reusable(post, "PARENT", null)) ??
      (await this.create(post, "PARENT", null, () =>
        this.api.createCarouselContainer(post.igUserId, post.token, {
          children: children.map((child) => child.igContainerId),
          caption: post.caption,
        }),
      ));

    await this.waitReady(post, [parent]);
    return parent;
  }

  private async publish(post: PostToPublish, container: PublishContainer): Promise<void> {
    await this.checkCeiling(post);
    await this.hold(post);
    if (!(await this.store.markPublishRequested(container.id, post.postId, post.runId))) throw new StopRun();

    const started = Date.now();
    let mediaId: string;
    try {
      mediaId = await this.api.publish(post.igUserId, post.token, container.igContainerId);
    } catch (error) {
      const ambiguous =
        error instanceof InstagramUnavailableError ||
        (error instanceof MetaRefusedError && classifyRefusal(error.meta, "PUBLISH").kind === "AMBIGUOUS");
      if (!ambiguous) {
        // Recusa clara: ainda assim, confere. Se o container diz PUBLISHED, saiu.
        if ((await this.readStatus(post, container)) === "PUBLISHED") return this.recordPublished(post, null);
        return this.handleError(post, error, "PUBLISH", container, started);
      }

      await recordPublishEvent(this.prisma.db, {
        postId: post.postId,
        step: "PUBLISH",
        result: "RECOVERABLE_ERROR",
        durationMs: Date.now() - started,
        metaResponse: error instanceof MetaRefusedError && error.detail ? { ...error.detail } : { ambiguous: true },
      });
      await this.reconcile(post, container, new Date());
      // O container não foi consumido: a próxima execução publica este mesmo.
      throw new PublishRetryError("PUBLISH_UNCERTAIN");
    }

    // O permalink é conveniência da tela; sem ele a postagem continua publicada.
    const permalink = await this.api.permalink(mediaId, post.token).catch(() => null);
    await this.recordPublished(post, { externalId: mediaId, permalink }, Date.now() - started);
  }

  /**
   * Depois de um publish sem resposta, o estado do container decide (docs/09).
   * Volta normalmente só quando é seguro publicar de novo **o mesmo** container.
   */
  private async reconcile(post: PostToPublish, container: PublishContainer, requestedAt: Date): Promise<void> {
    await this.hold(post);
    await this.sleep(requestedAt.getTime() + this.config.reconcileWaitMs - Date.now(), post.signal);

    const status = await this.readStatus(post, container);
    if (status === null) throw new PublishRetryError("PUBLISH_UNCERTAIN");

    const decision = reconcile(status);
    if (decision === "PUBLISHED") return this.recordPublished(post, null);
    if (decision === "UNCERTAIN") return this.stop(post, "PUBLISH_UNCERTAIN", "RECONCILE", { status_code: status });
    // RETRY: não foi consumido. Mas publicar agora ainda precisa caber no teto.
    await this.checkCeiling(post);
  }

  /**
   * Registra a publicação: a `Publicacao`, o `PUBLICADO` e as tarefas de métrica,
   * numa transação só (AGENTS.md, regra 8).
   *
   * `ON CONFLICT DO NOTHING`, e não `create` com `catch`: dentro de uma transação, a
   * primeira instrução que falha aborta todas as seguintes. As métricas só nascem
   * para a linha que esta execução gravou — e só com o id da mídia, que é o que a
   * coleta precisa.
   *
   * Sem id (`published` nulo): confirmada pelo estado do container, sem que a Meta
   * devolvesse o id (V-28). Publicada sem link, nunca `FALHOU`.
   */
  private async recordPublished(
    post: PostToPublish,
    published: { externalId: string; permalink: string | null } | null,
    durationMs?: number,
  ): Promise<never> {
    const publishedAt = new Date();

    await this.prisma.db.$transaction(async (tx) => {
      const { count } = await tx.publication.createMany({
        data: [
          {
            postId: post.postId,
            externalId: published?.externalId ?? null,
            permalink: published?.permalink ?? null,
            publishedAt,
          },
        ],
        skipDuplicates: true,
      });
      await this.store.publish(tx, post.postId);

      if (count === 1 && published !== null) {
        for (const { moment, startAfter } of metricMomentsFor(post.format, publishedAt)) {
          await this.queues.boss.send(POST_METRICS_QUEUE, { postId: post.postId, moment }, { startAfter, db: fromPrisma(tx) });
        }
      }

      await recordPublishEvent(tx, {
        postId: post.postId,
        step: published === null ? "RECONCILE" : "PUBLISH",
        result: "SUCCESS",
        ...(durationMs === undefined ? {} : { durationMs }),
        metaResponse: published === null ? { reconciled: true } : { id: published.externalId },
      });
    });

    this.logger.log(`Postagem ${post.postId} publicada${published === null ? " (confirmada pelo container)" : ""}.`);
    throw new StopRun();
  }

  private async create(
    post: PostToPublish,
    role: "SINGLE" | "PARENT" | "CHILD",
    position: number | null,
    call: () => Promise<string>,
  ): Promise<PublishContainer> {
    await this.checkCeiling(post);
    await this.hold(post);

    const started = Date.now();
    let igContainerId: string;
    try {
      igContainerId = await call();
    } catch (error) {
      return this.handleError(post, error, "CREATE_CONTAINER", null, started);
    }

    // Gravado na hora: uma queda logo depois não perde o container, e a próxima
    // execução o reaproveita em vez de criar outro (docs/09).
    const container = await this.prisma.db.publishContainer.create({
      data: {
        postId: post.postId,
        igContainerId,
        role,
        position,
        postVersion: post.version,
        expiresAt: new Date(Date.now() + CONTAINER_TTL_MS),
      },
    });
    await recordPublishEvent(this.prisma.db, {
      postId: post.postId,
      step: "CREATE_CONTAINER",
      result: "SUCCESS",
      durationMs: Date.now() - started,
      metaResponse: { id: igContainerId },
    });
    return container;
  }

  /** Consulta cada container até todos ficarem prontos, uma volta por intervalo. */
  private async waitReady(post: PostToPublish, containers: PublishContainer[]): Promise<void> {
    const pending = new Map(containers.map((container) => [container.id, container]));

    for (;;) {
      for (const container of [...pending.values()]) {
        const started = Date.now();
        let status: ContainerStatusCode;
        try {
          status = (await this.api.containerStatus(container.igContainerId, post.token)).statusCode;
        } catch (error) {
          return this.handleError(post, error, "CHECK_STATUS", container, started);
        }
        await this.saveStatus(container, status);

        const decision = pollDecision(status, container.createdAt, new Date());
        if (decision.kind === "READY") pending.delete(container.id);
        else if (decision.kind === "ALREADY_PUBLISHED") {
          // Só o container que se publica pode estar publicado; um filho assim é
          // parte de um carrossel que já saiu, e serve como pronto.
          if (container.role === "CHILD") pending.delete(container.id);
          else return this.recordPublished(post, null);
        } else if (decision.kind === "FATAL") {
          return this.stop(post, decision.cause, "CHECK_STATUS", { status_code: status });
        } else if (decision.kind === "RECOVERABLE") {
          await recordPublishEvent(this.prisma.db, {
            postId: post.postId,
            step: "CHECK_STATUS",
            result: "RECOVERABLE_ERROR",
            metaResponse: { status_code: status },
          });
          throw new PublishRetryError(decision.cause);
        }
      }

      if (pending.size === 0) return;
      await this.hold(post);
      await this.sleep(this.config.statusPollIntervalMs, post.signal);
    }
  }

  /**
   * Traduz o erro de uma chamada à Meta no que fazer (domain/publishing/classify).
   * Nunca volta: ou lança para nova tentativa, ou manda para `FALHOU`.
   */
  private async handleError(
    post: PostToPublish,
    error: unknown,
    step: PublishStepName,
    container: PublishContainer | null,
    started: number,
  ): Promise<never> {
    let outcome;
    if (error instanceof MetaRefusedError) outcome = classifyRefusal(error.meta, step);
    else if (error instanceof InstagramUnavailableError) outcome = classifyUnavailable(step);
    else throw error;

    const metaResponse: Prisma.InputJsonValue =
      error instanceof MetaRefusedError && error.detail ? { ...error.detail } : { status: "sem resposta" };
    const tag = error instanceof MetaRefusedError ? `meta ${error.meta.code ?? "?"}/${error.meta.subcode ?? "?"}` : "rede";

    if (outcome.kind === "FATAL") {
      return this.stop(post, outcome.cause, step, metaResponse, tag, outcome.flagsAccount);
    }

    await recordPublishEvent(this.prisma.db, {
      postId: post.postId,
      step,
      result: "RECOVERABLE_ERROR",
      durationMs: Date.now() - started,
      metaResponse,
    });
    // O container que falhou ao ser criado do lado da Meta não serve mais.
    if (outcome.kind === "RECOVERABLE" && outcome.discardContainer && container) {
      await this.saveStatus(container, "ERROR");
    }
    throw new PublishRetryError(outcome.kind === "RECOVERABLE" ? outcome.cause : "PUBLISH_UNCERTAIN");
  }

  /** `FALHOU`, cercado por esta execução, e fim da execução. */
  private async stop(
    ctx: RunContext & { accountId?: string },
    cause: PublishFailureCause,
    step: PublishStepValue,
    metaResponse?: Prisma.InputJsonValue,
    tag?: string,
    flagsAccount = false,
  ): Promise<never> {
    await this.failures.fail({
      postId: ctx.postId,
      cause,
      step,
      fence: { runId: ctx.runId },
      tag: tag ?? null,
      ...(metaResponse === undefined ? {} : { metaResponse }),
      flagAccountId: flagsAccount ? (ctx.accountId ?? null) : null,
    });
    throw new StopRun();
  }

  /** Passou dos 45 minutos: nenhuma chamada nova à Meta (ADR 0007). */
  private async checkCeiling(post: PostToPublish): Promise<void> {
    if (isPastCeiling(post.scheduledAt, new Date())) await this.stop(post, "LATE_CEILING", "GIVE_UP");
  }

  /** Renova o arrendamento. Perdido, ou o pg-boss mandou parar: sai sem escrever nada. */
  private async hold(ctx: RunContext): Promise<void> {
    if (ctx.signal.aborted) throw new StopRun();
    if (!(await this.store.holdLease(ctx.postId, ctx.runId, this.config.leaseMs))) throw new StopRun();
  }

  /** Estado do container sem lançar — `null` se a Meta não respondeu. */
  private async readStatus(post: PostToPublish, container: PublishContainer): Promise<ContainerStatusCode | null> {
    try {
      const { statusCode } = await this.api.containerStatus(container.igContainerId, post.token);
      await this.saveStatus(container, statusCode);
      return statusCode;
    } catch {
      return null;
    }
  }

  private async saveStatus(container: PublishContainer, statusCode: ContainerStatusCode): Promise<void> {
    await this.prisma.db.publishContainer.update({ where: { id: container.id }, data: { statusCode } });
    container.statusCode = statusCode;
  }

  private reusable(post: PostToPublish, role: "SINGLE" | "PARENT" | "CHILD", position: number | null) {
    const now = new Date();
    return (
      post.containers.find(
        (c) =>
          c.role === role &&
          isReusable(
            { expiresAt: c.expiresAt, statusCode: c.statusCode, postVersion: c.postVersion, position: c.position },
            { now, postVersion: post.version, position },
          ),
      ) ?? null
    );
  }

  /** Tudo o que a execução precisa, lido uma vez, com o token decifrado só em memória. */
  private async load(ctx: RunContext): Promise<PostToPublish> {
    const post = await this.prisma.db.post.findUniqueOrThrow({
      where: { id: ctx.postId },
      select: {
        format: true,
        caption: true,
        account: { select: { id: true, externalId: true, tokenEncrypted: true } },
        media: {
          orderBy: { position: "asc" },
          select: { position: true, altText: true, media: { select: { objectKey: true } } },
        },
        containers: { where: { postVersion: ctx.version }, orderBy: { createdAt: "desc" } },
      },
    });

    const base = { ...ctx, accountId: post.account.id };

    /*
     * Defesa: a composição e o agendamento já barram isto (RF-B03, ADR 0024), e
     * Reels só chega na Fase 2. Se chegar aqui mesmo assim, não é a Meta que deve
     * descobrir.
     */
    if (post.format === "REELS" || postMediaCountProblem(post.format, post.media.length) !== null) {
      return this.stop(base, "META_REFUSED", "GIVE_UP", { reason: "postagem fora do que a Fase 1 publica" });
    }

    let token: string;
    try {
      token = decryptSecret(post.account.tokenEncrypted, this.instagram.encryptionKey, "instagram-token");
    } catch {
      return this.stop(base, "TOKEN_UNREADABLE", "GIVE_UP", undefined, undefined, true);
    }

    return {
      ...base,
      igUserId: post.account.externalId,
      token,
      format: post.format,
      caption: post.caption ?? "",
      media: post.media.map((item) => ({
        position: item.position,
        altText: item.altText,
        url: publicUrlFor(item.media.objectKey, this.storage),
      })),
      containers: post.containers,
    };
  }

  private async repairIfPublished(postId: string): Promise<boolean> {
    const publication = await this.prisma.db.publication.findUnique({ where: { postId }, select: { id: true } });
    if (publication === null) return false;
    await this.store.publish(this.prisma.db, postId);
    return true;
  }

  /** Espera interrompível: se o pg-boss mandar parar, a execução sai sem escrever. */
  private sleep(ms: number, signal: AbortSignal): Promise<void> {
    if (ms <= 0) return Promise.resolve();
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        signal.removeEventListener("abort", onAbort);
        resolve();
      }, ms);
      const onAbort = () => {
        clearTimeout(timer);
        reject(new StopRun());
      };
      signal.addEventListener("abort", onAbort, { once: true });
    });
  }
}
