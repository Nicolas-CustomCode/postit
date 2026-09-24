import { Body, Controller, Get, HttpCode, Param, Post } from "@nestjs/common";
import {
  pushEndpointSchema,
  pushPreferenceSchema,
  pushSubscriptionSchema,
  type NotificationItem,
  type PushEndpointInput,
  type PushPreference,
  type PushPreferenceInput,
  type PushSubscriptionInput,
} from "@repo/shared";
import { AnyAuthenticated } from "../authorization/policy.decorators";
import { Auth } from "../auth/auth.decorators";
import type { AuthContext } from "../auth/session.service";
import { ZodValidationPipe } from "../common/zod-validation.pipe";
import { NotificationsDomainService } from "./notifications.domain.service";
import { NotificationsQueryService } from "./notifications.query.service";
import { PushSettingsService } from "./push-settings.service";

/**
 * O sino (RF-J01): listar, contar e marcar como lido.
 *
 * E o push (RF-J02, RF-J04): inscrever este aparelho, desativar, pedir um teste e
 * escolher os tipos.
 *
 * Tudo `@AnyAuthenticated`, e tudo sobre o que é **da própria pessoa** — o `userId`
 * vem da sessão, nunca do pedido. As escritas estão na lista fechada da regra 5,
 * como as rotas do perfil.
 */
@Controller("notifications")
export class NotificationsController {
  constructor(
    private readonly query: NotificationsQueryService,
    private readonly domain: NotificationsDomainService,
    private readonly push: PushSettingsService,
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

  /** As preferências de push por tipo (RF-J04). Valem para todos os aparelhos da pessoa. */
  @AnyAuthenticated()
  @Get("preferences")
  preferences(@Auth() auth: AuthContext): Promise<PushPreference[]> {
    return this.push.preferences(auth.userId);
  }

  @AnyAuthenticated()
  @Post("preferences")
  @HttpCode(200)
  setPreference(
    @Auth() auth: AuthContext,
    @Body(new ZodValidationPipe(pushPreferenceSchema)) body: PushPreferenceInput,
  ): Promise<PushPreference[]> {
    return this.push.setPreference(auth.userId, body);
  }

  /** Ativa o push neste aparelho, preso à sessão atual (RF-J02). */
  @AnyAuthenticated()
  @Post("push-subscriptions")
  @HttpCode(204)
  subscribe(
    @Auth() auth: AuthContext,
    @Body(new ZodValidationPipe(pushSubscriptionSchema)) body: PushSubscriptionInput,
  ): Promise<void> {
    return this.push.subscribe(auth.userId, auth.sessionId, body);
  }

  @AnyAuthenticated()
  @Post("push-subscriptions/remove")
  @HttpCode(204)
  unsubscribe(
    @Auth() auth: AuthContext,
    @Body(new ZodValidationPipe(pushEndpointSchema)) body: PushEndpointInput,
  ): Promise<void> {
    return this.push.unsubscribe(auth.userId, body.endpoint);
  }

  @AnyAuthenticated()
  @Post("push-subscriptions/test")
  @HttpCode(204)
  requestPushTest(
    @Auth() auth: AuthContext,
    @Body(new ZodValidationPipe(pushEndpointSchema)) body: PushEndpointInput,
  ): Promise<void> {
    return this.push.requestTest(auth.userId, body.endpoint, new Date());
  }

  @AnyAuthenticated()
  @Post(":notificationId/read")
  @HttpCode(200)
  markRead(@Auth() auth: AuthContext, @Param("notificationId") notificationId: string): Promise<NotificationItem> {
    return this.domain.markRead(auth.userId, notificationId, new Date());
  }
}
