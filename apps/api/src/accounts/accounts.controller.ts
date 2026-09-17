import { Body, Controller, Get, HttpCode, Post } from "@nestjs/common";
import { connectAccountSchema, type AccountSummary } from "@repo/shared";
import { AnyAuthenticated, RequirePermission } from "../authorization/policy.decorators";
import { Auth } from "../auth/auth.decorators";
import type { AuthContext } from "../auth/session.service";
import { ZodValidationPipe } from "../common/zod-validation.pipe";
import { AccountsDomainService } from "./accounts.domain.service";
import { AccountsQueryService } from "./accounts.query.service";

/**
 * As contas do Instagram conectadas.
 *
 * Leitura é `@AnyAuthenticated`: qualquer pessoa logada precisa saber em que
 * conta está trabalhando. Conectar é **ação**, e exige `ACCOUNT_MANAGE`
 * (AGENTS.md, regra 5; ADR 0015).
 */
@Controller("accounts")
export class AccountsController {
  constructor(
    private readonly accounts: AccountsQueryService,
    private readonly connections: AccountsDomainService,
  ) {}

  @AnyAuthenticated()
  @Get()
  list(): Promise<AccountSummary[]> {
    return this.accounts.list(new Date());
  }

  /**
   * Começa a conexão: devolve para onde mandar a pessoa autorizar.
   *
   * A API devolve a URL em vez de redirecionar — quem redireciona o navegador é
   * o Next. A API não conhece navegador nenhum (regra 4).
   */
  @RequirePermission("ACCOUNT_MANAGE")
  @Post("connect")
  @HttpCode(200)
  startConnection(@Auth() auth: AuthContext): { authorizationUrl: string } {
    return { authorizationUrl: this.connections.startConnection(auth.userId, new Date()) };
  }

  /** Conclui a conexão com o que a Meta devolveu no retorno. */
  @RequirePermission("ACCOUNT_MANAGE")
  @Post("connect/finish")
  @HttpCode(200)
  async finishConnection(
    @Auth() auth: AuthContext,
    @Body(new ZodValidationPipe(connectAccountSchema)) body: { code: string; state: string },
  ): Promise<{ username: string }> {
    const username = await this.connections.finishConnection({
      userId: auth.userId,
      code: body.code,
      state: body.state,
      now: new Date(),
    });

    return { username };
  }
}
