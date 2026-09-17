import { Module, type DynamicModule } from "@nestjs/common";
import type { ApiEnv } from "../config/env";
import { ACCOUNTS_CONFIG, accountsConfigFrom } from "./accounts.config";
import { AccountsController } from "./accounts.controller";
import { AccountsQueryService } from "./accounts.query.service";

/**
 * Contas do Instagram.
 *
 * Nesta etapa só lê. O OAuth, a renovação de token e a coleta de métricas
 * chegam na etapa 2 — e a renovação mora no worker, nunca aqui.
 */
@Module({})
export class AccountsModule {
  static forEnv(env: ApiEnv): DynamicModule {
    return {
      module: AccountsModule,
      controllers: [AccountsController],
      providers: [{ provide: ACCOUNTS_CONFIG, useValue: accountsConfigFrom(env) }, AccountsQueryService],
      exports: [AccountsQueryService],
    };
  }
}
