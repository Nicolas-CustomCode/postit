import { Module, type DynamicModule } from "@nestjs/common";
import type { ApiEnv } from "../config/env";
import { InstagramModule } from "../instagram/instagram.module";
import { ACCOUNTS_CONFIG, accountsConfigFrom } from "./accounts.config";
import { AccountsController } from "./accounts.controller";
import { AccountsDomainService } from "./accounts.domain.service";
import { AccountsQueryService } from "./accounts.query.service";

/**
 * Contas do Instagram: listar e conectar.
 *
 * Importa só o `InstagramModule`, pelo OAuth. A chave de cifra vem do próprio
 * `ACCOUNTS_CONFIG`: importar o `AuthModule` para pegá-la registraria o
 * controlador de autenticação uma segunda vez, porque `forEnv` devolve um módulo
 * novo a cada chamada — e o Fastify recusa a rota duplicada.
 *
 * **Renovação de token e coleta de métricas não moram aqui** — são do worker, e
 * ele as importa pelo `PublishingModule` (AGENTS.md, regra 1).
 */
@Module({})
export class AccountsModule {
  static forEnv(env: ApiEnv): DynamicModule {
    return {
      module: AccountsModule,
      imports: [InstagramModule.forEnv(env)],
      controllers: [AccountsController],
      providers: [
        { provide: ACCOUNTS_CONFIG, useValue: accountsConfigFrom(env) },
        AccountsQueryService,
        AccountsDomainService,
      ],
      exports: [AccountsQueryService],
    };
  }
}
