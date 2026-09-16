import { ArgumentsHost, Catch, type ExceptionFilter, HttpException, Logger } from "@nestjs/common";
import { AUTH_ERROR_MESSAGES, type ApiErrorBody } from "@repo/shared";
import type { FastifyReply } from "fastify";
import { AppError } from "../errors";

/**
 * Traduz exceção em resposta, e é o único lugar que escreve corpo de erro.
 *
 * ⚠️ O que ele NÃO faz: registrar o corpo da requisição. É ali que estariam a
 * senha tentada e o código digitado (AGENTS.md, regra 3). O log leva rota,
 * método e código do erro — o bastante para achar o problema, nada além.
 *
 * Erro que não é nosso vira 500 genérico: mensagem de biblioteca costuma trazer
 * consulta SQL, caminho de arquivo e, no pior caso, o valor que estourou.
 */
@Catch()
export class AppExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger("Erro");

  catch(exception: unknown, host: ArgumentsHost): void {
    const http = host.switchToHttp();
    const request = http.getRequest<{ method: string; url: string }>();
    const reply = http.getResponse<FastifyReply>();

    const { status, body } = this.translate(exception);
    if (status >= 500) {
      // Só aqui o erro cru é interessante, e ele vai para o log do servidor —
      // nunca para a resposta.
      this.logger.error(`${request.method} ${request.url} — ${String(exception)}`);
    } else {
      this.logger.warn(`${request.method} ${request.url} — ${body.code}`);
    }

    void reply.status(status).send(body);
  }

  private translate(exception: unknown): { status: number; body: ApiErrorBody } {
    if (exception instanceof AppError) {
      return { status: exception.status, body: exception.body() };
    }

    // Erros do próprio Nest (rota inexistente, corpo acima do limite, guarda que
    // recusou antes do nosso código) já têm status; a mensagem não é nossa, mas
    // é do framework e não carrega dado do usuário.
    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const code = status === 401 ? "UNAUTHENTICATED" : status === 403 ? "FORBIDDEN" : "VALIDATION_FAILED";
      return { status, body: { code, message: AUTH_ERROR_MESSAGES[code] } };
    }

    return { status: 500, body: { code: "INTERNAL_ERROR", message: AUTH_ERROR_MESSAGES.INTERNAL_ERROR } };
  }
}
