import { Injectable, Logger } from "@nestjs/common";
import type { Prisma } from "@repo/database";
import type { PublishFailureCause } from "@repo/shared";
import { recordNotice } from "../../notifications/record-notice";
import { PrismaService } from "../../prisma/prisma.service";
import { PostOutcomeStore } from "./post-outcome.store";
import { recordPublishEvent, type PublishStepValue } from "./publish-events";

export interface FailPostInput {
  readonly postId: string;
  readonly cause: PublishFailureCause;
  readonly step: PublishStepValue;
  readonly fence: Parameters<PostOutcomeStore["fail"]>[4];
  /** Rótulo técnico para quem investiga, como `meta 190/463`. Nunca vai para a tela. */
  readonly tag?: string | null;
  readonly metaResponse?: Prisma.InputJsonValue;
  /** A conta ganha o sinal de acesso perdido (token inválido, permissão ausente). */
  readonly flagAccountId?: string | null;
}

/**
 * **Toda** postagem que vai para `FALHOU` passa por aqui — despachante, publicador
 * e tratador de falhas.
 *
 * Um lugar só porque o que acompanha a falha precisa entrar na **mesma
 * transação** (AGENTS.md, regra 8): o status, o evento de auditoria, o sinal na
 * conta e os avisos do sino — `PUBLICACAO_FALHOU` e, na primeira vez,
 * `CONTA_SEM_ACESSO`. Espalhado em três chamadores, um deles esqueceria um.
 */
@Injectable()
export class PublishFailureService {
  private readonly logger = new Logger("Publicacao");

  constructor(
    private readonly prisma: PrismaService,
    private readonly store: PostOutcomeStore,
  ) {}

  /** `false` quando a cerca não deixou: outra execução ou outro ciclo cuida da postagem. */
  async fail(input: FailPostInput): Promise<boolean> {
    const failed = await this.prisma.db.$transaction(async (tx) => {
      const ok = await this.store.fail(tx, input.postId, input.cause, input.tag ?? null, input.fence);
      if (!ok) return false;

      await recordPublishEvent(tx, {
        postId: input.postId,
        step: input.step,
        result: "FATAL_ERROR",
        metaResponse: input.metaResponse ?? { cause: input.cause },
      });

      const { scheduledById } = await tx.post.findUniqueOrThrow({
        where: { id: input.postId },
        select: { scheduledById: true },
      });
      await recordNotice(tx, { type: "POST", id: input.postId }, { type: "PUBLISH_FAILED", scheduledById });

      if (input.flagAccountId) {
        const marcada = await tx.account.updateMany({
          where: { id: input.flagAccountId, accessLostAt: null },
          data: { accessLostAt: new Date() },
        });
        // Só na passagem de nulo para marcado: a segunda postagem que falha na mesma
        // conta não repete o aviso.
        if (marcada.count === 1) {
          await recordNotice(tx, { type: "ACCOUNT", id: input.flagAccountId }, { type: "ACCOUNT_ACCESS_LOST" });
        }
      }
      return true;
    });

    if (failed) this.logger.warn(`Postagem ${input.postId} foi para FALHOU: ${input.cause}.`);
    return failed;
  }
}
