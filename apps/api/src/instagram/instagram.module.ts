import { Module, type DynamicModule } from "@nestjs/common";
import type { ApiEnv, WorkerEnv } from "../config/env";
import { InstagramAccountMetricsService } from "./account-metrics.service";
import { InstagramClient } from "./client";
import { INSTAGRAM_CONFIG, instagramConfigFrom } from "./instagram.config";
import { InstagramOAuthService } from "./oauth.service";
import { InstagramProfilePhotoService } from "./profile-photo.service";
import { InstagramProfileService } from "./profile.service";
import { InstagramTokenRefreshService } from "./token-refresh.service";

/**
 * Tudo que fala com a Meta.
 *
 * ⚠️ Este módulo é **compartilhado** entre os dois processos, e isso não
 * contraria a regra 1. O que só o worker pode importar é `QueuesModule` e
 * `PublishingModule` — quem **publica**. Aqui mora o OAuth, que é do processo
 * HTTP, e o cliente, que o worker também usa para renovar token e ler métricas
 * (docs/08, "O cliente").
 *
 * O `InstagramOAuthService` funciona só na API: no worker, o `redirectUri` e o
 * `stateSecret` chegam nulos, e qualquer tentativa de usá-lo falha na hora em
 * vez de autorizar alguma coisa pela metade.
 */
@Module({})
export class InstagramModule {
  static forEnv(env: ApiEnv | WorkerEnv): DynamicModule {
    return {
      module: InstagramModule,
      providers: [
        { provide: INSTAGRAM_CONFIG, useValue: instagramConfigFrom(env) },
        InstagramClient,
        InstagramOAuthService,
        InstagramProfileService,
        InstagramProfilePhotoService,
        InstagramTokenRefreshService,
        InstagramAccountMetricsService,
      ],
      exports: [
        INSTAGRAM_CONFIG,
        InstagramClient,
        InstagramOAuthService,
        InstagramProfileService,
        InstagramProfilePhotoService,
        InstagramTokenRefreshService,
        InstagramAccountMetricsService,
      ],
    };
  }
}
