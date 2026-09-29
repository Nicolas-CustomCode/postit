import { DynamicModule, Module } from "@nestjs/common";
import { APP_GUARD, DiscoveryModule } from "@nestjs/core";
import { AccountsModule } from "./accounts/accounts.module";
import { AuthModule } from "./auth/auth.module";
import { SessionGuard } from "./auth/guards/session.guard";
import { PolicyGuard } from "./authorization/policy.guard";
import { InternalKeyGuard } from "./common/guards/internal-key.guard";
import type { ApiEnv } from "./config/env";
import { HealthController } from "./health/health.controller";
import { McpModule } from "./mcp/mcp.module";
import { MediaModule } from "./media/media.module";
import { NotificationsModule } from "./notifications/notifications.module";
import { OAuthModule } from "./oauth/oauth.module";
import { PostsModule } from "./posts/posts.module";
import { PrismaModule } from "./prisma/prisma.module";
import { StorageModule } from "./storage/storage.module";

/**
 * Módulos do processo HTTP.
 *
 * NUNCA importar aqui PublishingModule nem QueuesModule: só o worker publica
 * (invariante I-9). O teste de arquitetura confere isso.
 */
@Module({})
export class AppModule {
  static forEnv(env: ApiEnv): DynamicModule {
    // Montados uma vez só e passados adiante: `forEnv` devolve um módulo novo a cada
    // chamada, e importar dois registraria as mesmas rotas duas vezes.
    const auth = AuthModule.forEnv(env);
    const accounts = AccountsModule.forEnv(env);
    const oauth = OAuthModule.forEnv(env, auth);

    return {
      module: AppModule,
      // DiscoveryModule: é o que permite ao teste de política percorrer as rotas
      // sozinho, sem lista escrita à mão — lista manual envelhece em silêncio.
      imports: [
        DiscoveryModule,
        PrismaModule.forUrl(env.DATABASE_URL),
        StorageModule.forEnv(env),
        auth,
        accounts,
        MediaModule.forEnv(env),
        PostsModule.forEnv(env),
        NotificationsModule,
        oauth,
        McpModule.with({ oauth, accounts }),
      ],
      controllers: [HealthController],
      providers: [
        /*
         * Três guardas globais, e a ORDEM é esta — o Nest executa na ordem em
         * que aparecem aqui:
         *
         *  1. chave interna: nenhuma rota escapa, nem as públicas. "Público"
         *     quer dizer "não exige sessão", não "aberto na internet";
         *  2. sessão: resolve quem é, sem decidir nada;
         *  3. política: decide, negando por padrão.
         *
         * Inverter 2 e 3 faz toda rota autenticada responder 403, porque a
         * política olharia uma requisição em que ninguém foi resolvido ainda.
         */
        { provide: APP_GUARD, useFactory: () => new InternalKeyGuard(env.INTERNAL_API_KEY) },
        { provide: APP_GUARD, useClass: SessionGuard },
        { provide: APP_GUARD, useClass: PolicyGuard },
      ],
    };
  }
}
