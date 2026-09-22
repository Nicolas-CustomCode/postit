import type { Prisma, PrismaClient } from "@repo/database";

/**
 * Uma linha em `EventoPublicacao` por etapa de cada tentativa (docs/09,
 * "Observabilidade"; RNF-10: dado o id de uma postagem, dá para reconstruir tudo
 * sem log solto).
 *
 * `metaResponse` recebe só o que já saiu limpo do cliente — o `detail` de uma
 * recusa, ou o id e o estado de uma resposta. **Nunca o token** (AGENTS.md,
 * regra 3): nada aqui monta resposta a partir de objeto cru.
 */
export type PublishStepValue = "CREATE_CONTAINER" | "CHECK_STATUS" | "PUBLISH" | "DISPATCH" | "RECONCILE" | "GIVE_UP";
export type StepResultValue = "SUCCESS" | "RECOVERABLE_ERROR" | "FATAL_ERROR";

export interface PublishEventInput {
  readonly postId: string;
  readonly step: PublishStepValue;
  readonly result: StepResultValue;
  readonly durationMs?: number;
  readonly metaResponse?: Prisma.InputJsonValue;
}

export async function recordPublishEvent(
  db: Pick<PrismaClient, "publishEvent"> | Prisma.TransactionClient,
  event: PublishEventInput,
): Promise<void> {
  await db.publishEvent.create({
    data: {
      postId: event.postId,
      step: event.step,
      result: event.result,
      durationMs: event.durationMs ?? null,
      ...(event.metaResponse === undefined ? {} : { metaResponse: event.metaResponse }),
    },
  });
}
