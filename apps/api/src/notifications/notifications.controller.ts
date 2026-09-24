import { Controller, Get, HttpCode, Param, Post } from "@nestjs/common";
import type { NotificationItem } from "@repo/shared";
import { AnyAuthenticated } from "../authorization/policy.decorators";
import { Auth } from "../auth/auth.decorators";
import type { AuthContext } from "../auth/session.service";
import { NotificationsDomainService } from "./notifications.domain.service";
import { NotificationsQueryService } from "./notifications.query.service";

/**
 * O sino (RF-J01): listar, contar e marcar como lido.
 *
 * Tudo `@AnyAuthenticated`, e tudo sobre as **próprias** entregas — o `userId` vem
 * da sessão, nunca do pedido. Marcar como lido é escrita de qualquer logado, e por
 * isso está na lista fechada da regra 5: mexe só no que é da própria pessoa, como
 * as rotas do perfil.
 */
@Controller("notifications")
export class NotificationsController {
  constructor(
    private readonly query: NotificationsQueryService,
    private readonly domain: NotificationsDomainService,
  ) {}

  @AnyAuthenticated()
  @Get()
  list(@Auth() auth: AuthContext): Promise<NotificationItem[]> {
    return this.query.list(auth.userId);
  }

  @AnyAuthenticated()
  @Get("unread-count")
  unreadCount(@Auth() auth: AuthContext): Promise<{ count: number }> {
    return this.query.unreadCount(auth.userId);
  }

  @AnyAuthenticated()
  @Post("read-all")
  @HttpCode(200)
  markAllRead(@Auth() auth: AuthContext): Promise<{ updated: number }> {
    return this.domain.markAllRead(auth.userId, new Date());
  }

  @AnyAuthenticated()
  @Post(":notificationId/read")
  @HttpCode(200)
  markRead(@Auth() auth: AuthContext, @Param("notificationId") notificationId: string): Promise<NotificationItem> {
    return this.domain.markRead(auth.userId, notificationId, new Date());
  }
}
