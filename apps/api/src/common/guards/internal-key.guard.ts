import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from "@nestjs/common";
import type { FastifyRequest } from "fastify";
import { secretsEqual } from "../crypto";

export const INTERNAL_KEY_HEADER = "x-internal-key";

/**
 * Primeira guarda de toda requisição: só o Next, que conhece a chave, chega à API.
 *
 * A API já não tem nome público, mas a chave continua obrigatória — defesa em
 * camadas: na etapa 1, a rede interna do Easypanel pode ser compartilhada com
 * outros projetos (docs/adr/0020).
 */
@Injectable()
export class InternalKeyGuard implements CanActivate {
  constructor(private readonly expectedKey: string) {}

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<FastifyRequest>();
    const received = request.headers[INTERNAL_KEY_HEADER];

    if (typeof received !== "string" || !secretsEqual(received, this.expectedKey)) {
      // Mesma resposta para chave ausente e errada: nada a aprender tentando.
      throw new UnauthorizedException();
    }
    return true;
  }
}
