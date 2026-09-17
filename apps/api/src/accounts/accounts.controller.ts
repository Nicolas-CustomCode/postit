import { Controller, Get } from "@nestjs/common";
import type { AccountSummary } from "@repo/shared";
import { AnyAuthenticated } from "../authorization/policy.decorators";
import { AccountsQueryService } from "./accounts.query.service";

/**
 * As contas do Instagram conectadas.
 *
 * Leitura é `@AnyAuthenticated`: qualquer pessoa logada precisa saber em que
 * conta está trabalhando. Conectar, desconectar e trocar o fuso exigem
 * `CONTA_GERENCIAR` e chegam na etapa 2 (ADR 0015).
 */
@Controller("accounts")
export class AccountsController {
  constructor(private readonly accounts: AccountsQueryService) {}

  @AnyAuthenticated()
  @Get()
  list(): Promise<AccountSummary[]> {
    return this.accounts.list(new Date());
  }
}
