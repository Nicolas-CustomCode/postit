import { Injectable, type CanActivate, type ExecutionContext } from "@nestjs/common";
import type { FastifyRequest } from "fastify";
import { bearerToken } from "../../common/request-context";
import { SessionService, type AuthContext } from "../session.service";

/** O que o guard pendura na requisição para o resto da cadeia enxergar. */
export interface AuthenticatedRequest extends FastifyRequest {
  auth?: AuthContext;
}

/**
 * Resolve a sessão e **não decide nada**.
 *
 * Nunca recusa, nem sem token: quem decide é o PolicyGuard, logo depois. Separar
 * as duas coisas é o que permite uma rota pública saber quem é a pessoa quando
 * ela está logada, sem abrir exceção no guard de política.
 *
 * O token vem em `Authorization: Bearer`, nunca em cookie — é isso que mantém a
 * API sem CORS, sem CSRF e sem SameSite para configurar. O cookie é do Next.
 */
@Injectable()
export class SessionGuard implements CanActivate {
  constructor(private readonly sessions: SessionService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const token = bearerToken(request);
    if (token !== null) {
      const auth = await this.sessions.resolve(token, new Date());
      if (auth !== null) request.auth = auth;
    }
    return true;
  }
}
