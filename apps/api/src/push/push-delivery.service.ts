import { Inject, Injectable, Logger } from "@nestjs/common";
import { isPushNotificationType, PUSH_TEST_PAYLOAD, pushPayloadFor, type PushPayload } from "@repo/shared";
import { fromPrisma } from "pg-boss";
import { sessionState } from "../domain/auth/session-validity";
import { PrismaService } from "../prisma/prisma.service";
import { BossService } from "../queues/boss.service";
import { NOTIFY_QUEUE } from "../queues/queue-names";
import { PUSH_CONFIG, type PushConfig } from "./push.config";
import { PushSender } from "./push-sender";

/** Uma tarefa de `notificar`: uma entrega do sino, ou um push de teste pedido no Perfil. */
export type NotifyJobData = { readonly deliveryId: string } | { readonly subscriptionId: string; readonly test: true };

/** Push atrasado não serve para nada: o aviso de mais de uma hora fica só no sino. */
const STALE_MS = 60 * 60 * 1000;
const BATCH = 100;
/** Falhas seguidas que não são "não existe mais" — a inscrição morreu por outro motivo. */
export const MAX_CONSECUTIVE_FAILURES = 5;

interface Subscription {
  readonly id: string;
  readonly endpoint: string;
  readonly p256dhKey: string;
  readonly authKey: string;
  readonly session: { readonly expiresAt: Date; readonly lastUsedAt: Date; readonly revokedAt: Date | null };
}

/**
 * O push, do lado do worker (RF-J02; ADR 0017).
 *
 * **Varrer** acha as entregas do sino que ainda não foram por push e as põe na fila
 * `notificar`, marcando antes: é "no máximo uma vez" — um push perdido é aceitável,
 * dois iguais no aparelho não. O `FOR UPDATE SKIP LOCKED` deixa duas varreduras
 * juntas dividirem o trabalho sem que a mesma entrega saia duas vezes.
 *
 * **Entregar** manda a cada aparelho da pessoa, respeitando a preferência do tipo.
 * A inscrição de **sessão morta** — saiu do PostIt, revogou o aparelho, venceu — é
 * apagada sem envio: é o que faz o push parar junto com a sessão, sem mexer em
 * nenhum dos caminhos de logout.
 *
 * ⚠️ O log cita só ids e números, nunca o `endpoint` (regra 3).
 */
@Injectable()
export class PushDeliveryService {
  private readonly logger = new Logger("Push");

  constructor(
    private readonly prisma: PrismaService,
    private readonly queues: BossService,
    private readonly sender: PushSender,
    @Inject(PUSH_CONFIG) private readonly config: PushConfig,
  ) {}

  async sweep(now: Date): Promise<{ stale: number; queued: number; tests: number }> {
    return this.prisma.db.$transaction(async (tx) => {
      // Antes da reserva, para as velhas não entrarem nela.
      const velhas = await tx.notificationDelivery.updateMany({
        where: { pushSentAt: null, notification: { createdAt: { lt: new Date(now.getTime() - STALE_MS) } } },
        data: { pushSentAt: now },
      });

      const pendentes = await tx.$queryRaw<{ id: string }[]>`
        SELECT id FROM "NotificacaoEntrega"
         WHERE "pushEnviadoEm" IS NULL
         ORDER BY id
         LIMIT ${BATCH}
         FOR UPDATE SKIP LOCKED`;
      if (pendentes.length > 0) {
        await tx.notificationDelivery.updateMany({
          where: { id: { in: pendentes.map((linha) => linha.id) } },
          data: { pushSentAt: now },
        });
      }
      // A tarefa nasce na mesma transação da marca (regra 8): desfeita uma, desfeita a outra.
      for (const { id } of pendentes) {
        await this.queues.boss.send(NOTIFY_QUEUE, { deliveryId: id } satisfies NotifyJobData, { db: fromPrisma(tx) });
      }

      const testes = await tx.$queryRaw<{ id: string }[]>`
        SELECT id FROM "InscricaoPush"
         WHERE "testePendenteEm" IS NOT NULL
         LIMIT ${BATCH}
         FOR UPDATE SKIP LOCKED`;
      if (testes.length > 0) {
        await tx.pushSubscription.updateMany({
          where: { id: { in: testes.map((linha) => linha.id) } },
          data: { testRequestedAt: null },
        });
      }
      for (const { id } of testes) {
        await this.queues.boss.send(NOTIFY_QUEUE, { subscriptionId: id, test: true } satisfies NotifyJobData, {
          db: fromPrisma(tx),
        });
      }

      return { stale: velhas.count, queued: pendentes.length, tests: testes.length };
    });
  }

  async deliver(data: NotifyJobData, now: Date): Promise<void> {
    if ("test" in data) {
      const inscricao = await this.prisma.db.pushSubscription.findUnique({
        where: { id: data.subscriptionId },
        select: SUBSCRIPTION_SELECT,
      });
      if (inscricao !== null) await this.sendTo(inscricao, PUSH_TEST_PAYLOAD, now);
      return;
    }

    const entrega = await this.prisma.db.notificationDelivery.findUnique({
      where: { id: data.deliveryId },
      select: { userId: true, notification: { select: { id: true, type: true } } },
    });
    if (entrega === null) return;
    const { type, id: notificationId } = entrega.notification;
    if (!isPushNotificationType(type)) return;

    // Sem linha, vale ligado (RF-J04). O sino já recebeu de qualquer jeito.
    const preferencia = await this.prisma.db.notificationPreference.findUnique({
      where: { userId_type: { userId: entrega.userId, type } },
      select: { push: true },
    });
    if (preferencia?.push === false) return;

    const inscricoes = await this.prisma.db.pushSubscription.findMany({
      where: { userId: entrega.userId },
      select: SUBSCRIPTION_SELECT,
    });
    const payload = pushPayloadFor(type, notificationId);
    for (const inscricao of inscricoes) await this.sendTo(inscricao, payload, now);
  }

  private async sendTo(inscricao: Subscription, payload: PushPayload, now: Date): Promise<void> {
    if (sessionState(inscricao.session, now, this.config.idleDays) !== "ACTIVE") {
      await this.prisma.db.pushSubscription.deleteMany({ where: { id: inscricao.id } });
      this.logger.log(`Inscrição ${inscricao.id} apagada: a sessão que a criou terminou.`);
      return;
    }

    const resultado = await this.sender.send(inscricao, payload);

    if (resultado === "ok") {
      await this.prisma.db.pushSubscription.updateMany({
        where: { id: inscricao.id },
        data: { lastSuccessAt: now, consecutiveFailures: 0 },
      });
      return;
    }

    if (resultado === "gone") {
      await this.prisma.db.pushSubscription.deleteMany({ where: { id: inscricao.id } });
      this.logger.log(`Inscrição ${inscricao.id} apagada: o serviço de push diz que ela não existe mais.`);
      return;
    }

    await this.prisma.db.pushSubscription.updateMany({
      where: { id: inscricao.id },
      data: { consecutiveFailures: { increment: 1 } },
    });
    const apagada = await this.prisma.db.pushSubscription.deleteMany({
      where: { id: inscricao.id, consecutiveFailures: { gte: MAX_CONSECUTIVE_FAILURES } },
    });
    this.logger.warn(
      apagada.count > 0
        ? `Inscrição ${inscricao.id} apagada depois de ${MAX_CONSECUTIVE_FAILURES} falhas seguidas.`
        : `O envio para a inscrição ${inscricao.id} falhou.`,
    );
  }
}

const SUBSCRIPTION_SELECT = {
  id: true,
  endpoint: true,
  p256dhKey: true,
  authKey: true,
  session: { select: { expiresAt: true, lastUsedAt: true, revokedAt: true } },
} as const;
