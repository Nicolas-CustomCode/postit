import { Module } from "@nestjs/common";
import { NotificationsController } from "./notifications.controller";
import { NotificationsDomainService } from "./notifications.domain.service";
import { NotificationsQueryService } from "./notifications.query.service";
import { PushSettingsService } from "./push-settings.service";

/**
 * As rotas do sino, só no processo HTTP. A gravação dos avisos não mora aqui: é
 * `recordNotice`, uma função que os dois processos chamam dentro das suas
 * transações.
 *
 * Sem `forEnv`: não lê variável nenhuma, e o `PrismaService` vem do módulo global.
 */
@Module({
  controllers: [NotificationsController],
  providers: [NotificationsQueryService, NotificationsDomainService, PushSettingsService],
})
export class NotificationsModule {}
