import { Module, type DynamicModule } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module";
import type { ApiEnv } from "../config/env";
import { PrismaModule } from "../prisma/prisma.module";

/**
 * Os comandos admin:* rodam sem HTTP, como o worker.
 *
 * ⚠️ Não importa `AppModule`: subir os controllers e os guardas globais para
 * rodar um comando de terminal seria pedir uma porta que ninguém vai usar.
 */
@Module({})
export class CliModule {
  static forEnv(env: ApiEnv): DynamicModule {
    return {
      module: CliModule,
      imports: [PrismaModule.forUrl(env.DATABASE_URL), AuthModule.forEnv(env)],
    };
  }
}
