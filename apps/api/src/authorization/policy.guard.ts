import { Injectable, Logger, type CanActivate, type ExecutionContext } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { can, type Permission } from "@repo/shared";
import type { AuthenticatedRequest } from "../auth/guards/session.guard";
import { ForbiddenError, UnauthenticatedError } from "../common/errors";
import { PERMISSION_KEY, POLICY_KEY, RECENT_CONFIRMATION_KEY, type RoutePolicy } from "./policy.decorators";

/**
 * Decide o acesso. **Negar por padrão** — é a peça de maior retorno por linha
 * deste projeto.
 *
 * Rota sem política declarada não abre. O contrário (abrir por padrão, fechar
 * com decorator) faz uma rota nascer aberta quando alguém esquece o decorator, e
 * ninguém revisa o que não aparece. Aqui, esquecer **fecha** — e o log diz
 * exatamente qual classe e qual método corrigir.
 */
@Injectable()
export class PolicyGuard implements CanActivate {
  private readonly logger = new Logger("Política de acesso");

  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const handler = context.getHandler();
    const controller = context.getClass();
    const policy = this.reflector.getAllAndOverride<RoutePolicy | undefined>(POLICY_KEY, [handler, controller]);

    if (policy === undefined) {
      this.logger.error(`${controller.name}.${handler.name} não declara política de acesso — recusado`);
      throw new ForbiddenError("ROUTE_WITHOUT_POLICY");
    }

    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const auth = request.auth;

    if (policy === "PUBLIC") return true;
    if (auth === undefined) throw new UnauthenticatedError();

    if (policy === "SUPER_ADMIN" && !auth.superAdmin) throw new ForbiddenError();

    if (policy === "PERMISSION") {
      const required = this.reflector.getAllAndOverride<Permission[]>(PERMISSION_KEY, [handler, controller]) ?? [];
      // Precisa de todas as declaradas; super admin passa por ter todas.
      if (!required.every((permission) => can(auth, permission))) throw new ForbiddenError();
    }

    const needsConfirmation = this.reflector.getAllAndOverride<boolean | undefined>(RECENT_CONFIRMATION_KEY, [
      handler,
      controller,
    ]);
    if (needsConfirmation === true && !auth.recentlyConfirmed) {
      throw new ForbiddenError("RECENT_CONFIRMATION_REQUIRED");
    }

    return true;
  }
}
