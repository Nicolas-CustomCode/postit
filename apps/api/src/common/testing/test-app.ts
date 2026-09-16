import "reflect-metadata";
import type { NestFastifyApplication } from "@nestjs/platform-fastify";
import type { PrismaClient } from "@repo/database";
import { AUTH_CONFIG, type AuthConfig } from "../../auth/auth.config";
import { readApiEnv } from "../../config/env";
import { createApp } from "../../create-app";
import { PrismaService } from "../../prisma/prisma.service";
import { INTERNAL_KEY_HEADER } from "../guards/internal-key.guard";
import { CLIENT_IP_HEADER } from "../request-context";
import { resetAuthTables } from "./reset-database";
import { testDatabaseUrl } from "./test-database";

/**
 * Sobe a aplicação HTTP de verdade para os testes de integração — a mesma que
 * `main.ts` sobe, sem abrir porta, pelo `app.inject()` do Fastify.
 *
 * Um por arquivo de teste: com `maxWorkers: 1` eles rodam em série, e cada
 * arquivo limpa o banco antes de cada caso.
 */
export const TEST_INTERNAL_KEY = "chave-interna-de-teste-0000000000000000";

export interface TestRequest {
  method: "GET" | "POST";
  url: string;
  payload?: unknown;
  /** Token de sessão, que vai em Authorization: Bearer. */
  token?: string;
  /** IP do visitante, como o Next repassaria. */
  ip?: string;
  /** Cabeçalhos extras — usado para provar que alguns são ignorados. */
  headers?: Record<string, string>;
}

export interface TestApp {
  readonly app: NestFastifyApplication;
  readonly db: PrismaClient;
  readonly config: AuthConfig;
  request(input: TestRequest): Promise<{ statusCode: number; body: Record<string, unknown> }>;
  reset(): Promise<void>;
  close(): Promise<void>;
}

export async function bootTestApp(): Promise<TestApp> {
  const env = readApiEnv({
    ...process.env,
    NODE_ENV: "test",
    DATABASE_URL: testDatabaseUrl(),
    INTERNAL_API_KEY: TEST_INTERNAL_KEY,
  });

  const app = await createApp(env);
  await app.init();
  await app.getHttpAdapter().getInstance().ready();

  const db = app.get(PrismaService).db;
  const config = app.get<AuthConfig>(AUTH_CONFIG);

  return {
    app,
    db,
    config,
    async request({ method, url, payload, token, ip, headers }) {
      const response = await app.inject({
        method,
        url,
        headers: {
          // A chave interna vai sempre: rota "pública" é rota sem sessão, e
          // não rota aberta na internet.
          [INTERNAL_KEY_HEADER]: TEST_INTERNAL_KEY,
          ...(token === undefined ? {} : { authorization: `Bearer ${token}` }),
          ...(ip === undefined ? {} : { [CLIENT_IP_HEADER]: ip }),
          ...headers,
        },
        ...(payload === undefined ? {} : { payload: payload as object }),
      });

      const body = response.body.length === 0 ? {} : (response.json() as Record<string, unknown>);
      return { statusCode: response.statusCode, body };
    },
    reset: () => resetAuthTables(db),
    close: () => app.close(),
  };
}
