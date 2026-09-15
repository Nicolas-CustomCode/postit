import { readApiEnv, readWorkerEnv } from "./env";

const secret = "a".repeat(64);

const base = {
  NODE_ENV: "test",
  DATABASE_URL: "postgresql://u:s@127.0.0.1:5435/postit_test",
  MINIO_ENDPOINT: "http://127.0.0.1:9002",
  MINIO_ROOT_USER: "postit",
  MINIO_ROOT_PASSWORD: "senha-do-minio",
  MINIO_BUCKET: "postit",
  MINIO_PUBLIC_URL: "http://localhost:9002",
  ENCRYPTION_KEY: secret,
};

const api = {
  ...base,
  APP_URL: "http://localhost:3010",
  INTERNAL_API_KEY: "b".repeat(64),
  API_HOST: "127.0.0.1",
  API_PORT: "3011",
  STATE_SECRET: secret,
};

describe("variáveis de ambiente", () => {
  it("aceita a configuração mínima da API e converte a porta", () => {
    expect(readApiEnv(api).API_PORT).toBe(3011);
  });

  it("aplica os padrões de sessão", () => {
    const env = readApiEnv(api);
    expect(env.SESSION_IDLE_DAYS).toBe(7);
    expect(env.SESSION_MAX_DAYS).toBe(30);
  });

  it("recusa ENCRYPTION_KEY fora do formato, sem mostrar o valor", () => {
    const secretValue = "curto-e-secreto";
    let message = "";
    try {
      readApiEnv({ ...api, ENCRYPTION_KEY: secretValue });
    } catch (error) {
      message = (error as Error).message;
    }
    expect(message).toContain("ENCRYPTION_KEY");
    expect(message).not.toContain(secretValue);
  });

  it("recusa chave interna curta", () => {
    expect(() => readApiEnv({ ...api, INTERNAL_API_KEY: "curta" })).toThrow(/INTERNAL_API_KEY/);
  });

  it("trata variável opcional vazia como ausente", () => {
    expect(readApiEnv({ ...api, IG_APP_ID: "", IG_REDIRECT_URI: "" }).IG_APP_ID).toBeUndefined();
  });

  it("não exige do worker a chave interna nem a porta HTTP", () => {
    expect(() => readWorkerEnv(base)).not.toThrow();
  });
});
