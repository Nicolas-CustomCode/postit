import { Module, type DynamicModule } from "@nestjs/common";
import type { ApiEnv } from "../config/env";
import { ClientMetadataFetcher } from "./client-metadata.fetcher";
import { OAUTH_CONFIG, oauthConfigFrom } from "./oauth.config";
import { OAuthController } from "./oauth.controller";
import { OAuthService } from "./oauth.service";

/**
 * O PostIt como servidor OAuth do assistente (ADR 0029), só no processo HTTP.
 *
 * Recebe o módulo de autenticação **já montado** pelo `AppModule`, pela auditoria:
 * chamar `AuthModule.forEnv` de novo registraria as rotas de autenticação duas
 * vezes, e o Fastify recusa rota duplicada.
 */
@Module({})
export class OAuthModule {
  static forEnv(env: ApiEnv, auth: DynamicModule): DynamicModule {
    return {
      module: OAuthModule,
      imports: [auth],
      controllers: [OAuthController],
      providers: [{ provide: OAUTH_CONFIG, useValue: oauthConfigFrom(env) }, OAuthService, ClientMetadataFetcher],
      exports: [OAUTH_CONFIG, OAuthService],
    };
  }
}
