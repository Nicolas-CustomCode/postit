import { ArgumentsHost, Catch, type ExceptionFilter, Logger } from "@nestjs/common";
import type { FastifyReply } from "fastify";

/**
 * Erro das rotas de máquina do OAuth — `/oauth/token` e `/oauth/register`.
 *
 * O cliente OAuth espera `{ error, error_description }` (RFC 6749, seção 5.2;
 * RFC 7591, seção 3.2.2), e não o `{ code, message }` do resto da API. Por isso o
 * filtro próprio, só nessas rotas.
 *
 * A descrição é texto fixo escrito aqui: nunca o código, o token ou o verifier
 * recebidos (regra 3).
 */
export class OAuthError extends Error {
  constructor(
    readonly error: string,
    readonly description: string,
    readonly status = 400,
  ) {
    super(description);
    this.name = "OAuthError";
  }
}

@Catch(OAuthError)
export class OAuthErrorFilter implements ExceptionFilter {
  private readonly logger = new Logger("OAuth");

  catch(exception: OAuthError, host: ArgumentsHost): void {
    const http = host.switchToHttp();
    const request = http.getRequest<{ method: string; url: string }>();
    const reply = http.getResponse<FastifyReply>();

    this.logger.warn(`${request.method} ${request.url} — ${exception.error}`);
    void reply
      .status(exception.status)
      .header("cache-control", "no-store")
      .send({ error: exception.error, error_description: exception.description });
  }
}
