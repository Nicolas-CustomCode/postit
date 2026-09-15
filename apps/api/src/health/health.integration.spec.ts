import "reflect-metadata";
import type { NestFastifyApplication } from "@nestjs/platform-fastify";
import { VERSION } from "@repo/shared";
import { INTERNAL_KEY_HEADER } from "../common/guards/internal-key.guard";
import { testDatabaseUrl } from "../common/testing/test-database";
import { readApiEnv } from "../config/env";
import { BODY_LIMIT_BYTES, createApp } from "../create-app";

describe("API HTTP — integração com o Postgres de teste", () => {
  let app: NestFastifyApplication;
  const key = "c".repeat(64);

  beforeAll(async () => {
    const env = readApiEnv({
      ...process.env,
      NODE_ENV: "test",
      DATABASE_URL: testDatabaseUrl(),
      INTERNAL_API_KEY: key,
    });
    app = await createApp(env);
    await app.init();
    await app.getHttpAdapter().getInstance().ready();
  });

  afterAll(async () => {
    await app?.close();
  });

  it("recusa requisição sem a chave interna", async () => {
    const response = await app.inject({ method: "GET", url: "/health" });
    expect(response.statusCode).toBe(401);
  });

  it("recusa chave interna errada com a mesma resposta", async () => {
    const response = await app.inject({ method: "GET", url: "/health", headers: { [INTERNAL_KEY_HEADER]: "errada" } });
    expect(response.statusCode).toBe(401);
  });

  it("responde versão e banco com a chave certa", async () => {
    const response = await app.inject({ method: "GET", url: "/health", headers: { [INTERNAL_KEY_HEADER]: key } });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ version: VERSION, database: "ok" });
  });

  it("envia CSP que proíbe tudo, porque a API nunca serve página", async () => {
    const response = await app.inject({ method: "GET", url: "/health", headers: { [INTERNAL_KEY_HEADER]: key } });
    expect(response.headers["content-security-policy"]).toBe("default-src 'none';frame-ancestors 'none'");
  });

  it("recusa corpo acima de 1 MB", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/health",
      headers: { [INTERNAL_KEY_HEADER]: key, "content-type": "application/json" },
      payload: JSON.stringify({ data: "x".repeat(BODY_LIMIT_BYTES + 1) }),
    });
    expect(response.statusCode).toBe(413);
  });
});
