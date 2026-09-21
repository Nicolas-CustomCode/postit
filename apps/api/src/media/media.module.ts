import { Module, type DynamicModule } from "@nestjs/common";
import type { ApiEnv } from "../config/env";
import { MEDIA_CONFIG, mediaConfigFrom } from "./media.config";
import { MediaController } from "./media.controller";
import { MediaDomainService } from "./media.domain.service";
import { MediaQueryService } from "./media.query.service";

/**
 * Envio e validação de mídia (ADR 0012).
 *
 * ⚠️ **Não importa o `AuthModule`** para pegar o segredo de assinatura: `forEnv`
 * devolve um módulo novo a cada chamada, e importá-lo registraria o controlador
 * de autenticação uma segunda vez — o Fastify recusa a rota duplicada. Já
 * aconteceu neste projeto. O segredo vem do `MEDIA_CONFIG`.
 *
 * O `StorageService` não aparece aqui porque o `StorageModule` é global.
 */
@Module({})
export class MediaModule {
  static forEnv(env: ApiEnv): DynamicModule {
    return {
      module: MediaModule,
      controllers: [MediaController],
      providers: [
        { provide: MEDIA_CONFIG, useValue: mediaConfigFrom(env) },
        MediaDomainService,
        MediaQueryService,
      ],
    };
  }
}
