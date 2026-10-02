import { Module, type DynamicModule } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module";
import type { ApiEnv } from "../config/env";
import { InstagramModule } from "../instagram/instagram.module";
import { OAuthModule } from "../oauth/oauth.module";
import { PrismaModule } from "../prisma/prisma.module";
import { StorageModule } from "../storage/storage.module";

/**
 * Os comandos admin:* rodam sem HTTP, como o worker.
 *
 * ⚠️ Não importa `AppModule`: subir os controllers e os guardas globais para
 * rodar um comando de terminal seria pedir uma porta que ninguém vai usar.
 *
 * ⚠️ E não importa `PublishingModule` nem `QueuesModule` (AGENTS.md, regra 1).
 * O `admin:refresh-tokens` chega ao serviço de renovação pelo `InstagramModule`,
 * que é compartilhado — é por isso que o serviço mora lá, e não em `publishing/`.
 * O `StorageModule` vem junto porque a renovação recopia a foto de perfil.
 */
@Module({})
export class CliModule {
  static forEnv(env: ApiEnv): DynamicModule {
    // Uma referência só do módulo de autenticação: o OAuth o importa pela auditoria, e
    // dois `forEnv` seriam dois módulos (o mesmo cuidado do `AppModule`).
    const auth = AuthModule.forEnv(env);
    return {
      module: CliModule,
      imports: [
        PrismaModule.forUrl(env.DATABASE_URL),
        StorageModule.forEnv(env),
        auth,
        InstagramModule.forEnv(env),
        // O `admin:assistants` (ADR 0029).
        OAuthModule.forEnv(env, auth),
      ],
    };
  }
}
