import helmet from "@fastify/helmet";
import { NestFactory } from "@nestjs/core";
import { FastifyAdapter, type NestFastifyApplication } from "@nestjs/platform-fastify";
import { AppModule } from "./app.module";
import { warmPasswordVerification } from "./auth/password";
import { AppExceptionFilter } from "./common/filters/app-exception.filter";
import type { ApiEnv } from "./config/env";

/** Nenhuma rota da API aceita corpo acima de 1 MB (AGENTS.md, regra 10). Arquivo vai direto ao MinIO. */
export const BODY_LIMIT_BYTES = 1024 * 1024;

/**
 * Monta a aplicação HTTP. Separado do main.ts para os testes subirem exatamente a
 * mesma configuração, sem abrir porta.
 */
export async function createApp(env: ApiEnv): Promise<NestFastifyApplication> {
  const app = await NestFactory.create<NestFastifyApplication>(
    AppModule.forEnv(env),
    new FastifyAdapter({ bodyLimit: BODY_LIMIT_BYTES, trustProxy: false }),
    { logger: env.NODE_ENV === "test" ? false : ["log", "warn", "error"] },
  );

  // A API nunca serve página: política que proíbe tudo, padrão do hotclone (docs/adr/0014, seção 5).
  await app.register(helmet, {
    // useDefaults: false — sem isso o helmet junta a política padrão dele (style-src com
    // 'unsafe-inline', fontes de https:) à nossa, e ela deixa de proibir tudo.
    contentSecurityPolicy: { useDefaults: false, directives: { defaultSrc: ["'none'"], frameAncestors: ["'none'"] } },
  });

  // Único lugar que escreve corpo de erro — e que não registra o corpo da
  // requisição, onde estariam a senha tentada e o código digitado.
  app.useGlobalFilters(new AppExceptionFilter());

  // O hash isca precisa estar pronto ANTES do primeiro login: sem isto, a
  // primeira tentativa com e-mail inexistente sai mais rápida que as demais e
  // entrega quais e-mails existem.
  await warmPasswordVerification();

  app.enableShutdownHooks();
  return app;
}
