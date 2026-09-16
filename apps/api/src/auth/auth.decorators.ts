import { createParamDecorator, type ExecutionContext } from "@nestjs/common";
import { clientContext, type ClientContext } from "../common/request-context";
import type { AuthenticatedRequest } from "./guards/session.guard";
import type { AuthContext } from "./session.service";

/**
 * Quem está logado. Só use em rota que declara política de sessão: em rota
 * pública o valor pode não existir, e o tipo esconderia isso.
 */
export const Auth = createParamDecorator((_data: unknown, context: ExecutionContext): AuthContext => {
  const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
  if (request.auth === undefined) throw new Error("Rota sem sessão pediu o contexto de autenticação");
  return request.auth;
});

/** IP e navegador de quem está do outro lado — só de X-Real-IP (docs/11). */
export const Client = createParamDecorator((_data: unknown, context: ExecutionContext): ClientContext =>
  clientContext(context.switchToHttp().getRequest<AuthenticatedRequest>()),
);
