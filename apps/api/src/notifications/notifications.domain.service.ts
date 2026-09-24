import { Injectable } from "@nestjs/common";
import type { NotificationItem } from "@repo/shared";
import { NotificationNotFoundError } from "../common/errors";
import { PrismaService } from "../prisma/prisma.service";
import { NotificationsQueryService } from "./notifications.query.service";

/** Um id que o Postgres aceita numa coluna `uuid` — o resto seria erro de banco, e não 404. */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Marcar como lido (RF-J01). Só a própria entrega: o aviso é um só, mas cada
 * pessoa lê o seu.
 */
@Injectable()
export class NotificationsDomainService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly query: NotificationsQueryService,
  ) {}

  /** Marca e devolve o aviso, para a tela saber para onde levar. Idempotente. */
  async markRead(userId: string, notificationId: string, now: Date): Promise<NotificationItem> {
    if (!UUID.test(notificationId)) throw new NotificationNotFoundError();

    // `lidaEm` nulo na condição: reabrir um aviso não reescreve quando foi lido.
    await this.prisma.db.notificationDelivery.updateMany({
      where: { notificationId, userId, readAt: null },
      data: { readAt: now },
    });

    const aviso = await this.query.one(userId, notificationId);
    if (aviso === null) throw new NotificationNotFoundError();
    return aviso;
  }

  async markAllRead(userId: string, now: Date): Promise<{ updated: number }> {
    const { count } = await this.prisma.db.notificationDelivery.updateMany({
      where: { userId, readAt: null },
      data: { readAt: now },
    });
    return { updated: count };
  }
}
