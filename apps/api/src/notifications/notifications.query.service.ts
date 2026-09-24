import { Injectable } from "@nestjs/common";
import { NOTIFICATION_LIST_LIMIT, type NotificationItem } from "@repo/shared";
import { PrismaService } from "../prisma/prisma.service";

/**
 * O sino de cada pessoa (RF-J01): só as entregas **dela**, nunca as dos outros.
 *
 * O alvo é lido agora, e não no momento do aviso (docs/07): a postagem reagendada
 * mostra o horário novo, e a que não existe mais vem `null`.
 */
@Injectable()
export class NotificationsQueryService {
  constructor(private readonly prisma: PrismaService) {}

  async list(userId: string): Promise<NotificationItem[]> {
    const entregas = await this.prisma.db.notificationDelivery.findMany({
      where: { userId },
      include: { notification: true },
      // O id é UUIDv7, que cresce com o tempo: a mais recente primeiro, pelo índice.
      orderBy: { id: "desc" },
      take: NOTIFICATION_LIST_LIMIT,
    });
    return this.withTargets(entregas);
  }

  /** Uma só, para a tela saber o destino depois de marcar. `null` se não for desta pessoa. */
  async one(userId: string, notificationId: string): Promise<NotificationItem | null> {
    const entrega = await this.prisma.db.notificationDelivery.findUnique({
      where: { notificationId_userId: { notificationId, userId } },
      include: { notification: true },
    });
    return entrega === null ? null : ((await this.withTargets([entrega]))[0] ?? null);
  }

  /** O número do sino, consultado em toda tela: pelo índice `(usuarioId, lidaEm)`. */
  async unreadCount(userId: string): Promise<{ count: number }> {
    return { count: await this.prisma.db.notificationDelivery.count({ where: { userId, readAt: null } }) };
  }

  private async withTargets(entregas: readonly Entrega[]): Promise<NotificationItem[]> {
    const idsDe = (tipo: string) => entregas.filter((e) => e.notification.targetType === tipo).map((e) => e.notification.targetId);

    const contaSelect = { username: true, name: true, timezone: true } as const;
    const [posts, contas] = await Promise.all([
      this.prisma.db.post.findMany({
        where: { id: { in: idsDe("POST") } },
        select: { id: true, status: true, scheduledAt: true, account: { select: contaSelect } },
      }),
      this.prisma.db.account.findMany({ where: { id: { in: idsDe("ACCOUNT") } }, select: { id: true, ...contaSelect } }),
    ]);
    const postPorId = new Map(posts.map((post) => [post.id, post]));
    const contaPorId = new Map(contas.map((conta) => [conta.id, conta]));

    return entregas.map(({ notification: aviso, readAt }) => {
      const post = aviso.targetType === "POST" ? postPorId.get(aviso.targetId) : undefined;
      const conta = aviso.targetType === "ACCOUNT" ? contaPorId.get(aviso.targetId) : post?.account;

      return {
        id: aviso.id,
        type: aviso.type,
        createdAt: aviso.createdAt.toISOString(),
        readAt: readAt?.toISOString() ?? null,
        account: conta === undefined ? null : { username: conta.username, name: conta.name, timezone: conta.timezone },
        post:
          post === undefined
            ? null
            : { id: post.id, status: post.status, scheduledAt: post.scheduledAt?.toISOString() ?? null },
      };
    });
  }
}

interface Entrega {
  readonly readAt: Date | null;
  readonly notification: {
    readonly id: string;
    readonly type: NotificationItem["type"];
    readonly targetType: string;
    readonly targetId: string;
    readonly createdAt: Date;
  };
}
