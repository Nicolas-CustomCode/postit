import { Module, type DynamicModule } from "@nestjs/common";
import { AuditService } from "../audit/audit.service";
import type { ApiEnv } from "../config/env";
import { UsersService } from "../users/users.service";
import { AUTH_CONFIG, authConfigFrom } from "./auth.config";
import { AuthController } from "./auth.controller";
import { AuthService } from "./auth.service";
import { ChallengeService } from "./challenge.service";
import { LinksService } from "./links.service";
import { LockoutService } from "./lockout.service";
import { SecurityQueryService } from "./security.query.service";
import { SessionService } from "./session.service";
import { TotpService } from "./totp.service";

/**
 * Autenticação: senha, sessão, desafio, duas etapas, bloqueio e links.
 *
 * Exporta o que os guardas globais e os comandos admin:* precisam. A
 * configuração entra por `forEnv`, como no resto da API — nenhum serviço lê
 * process.env.
 */
@Module({})
export class AuthModule {
  static forEnv(env: ApiEnv): DynamicModule {
    return {
      module: AuthModule,
      controllers: [AuthController],
      providers: [
        { provide: AUTH_CONFIG, useValue: authConfigFrom(env) },
        AuthService,
        SessionService,
        ChallengeService,
        TotpService,
        LockoutService,
        LinksService,
        UsersService,
        AuditService,
        // Só a tela de Perfil consulta; nada fora do módulo precisa dele.
        SecurityQueryService,
      ],
      exports: [AUTH_CONFIG, SessionService, TotpService, LinksService, UsersService, AuditService],
    };
  }
}
