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

/**
 * A trava da regra 23: só o teste pode apontar a Meta para outro lugar.
 *
 * Sem ela, uma variável mal copiada no `.env` de produção mandaria token de
 * conta real para um servidor qualquer — e nada avisaria.
 */
describe("endereço da Meta", () => {
  const OUTRO = "http://127.0.0.1:3199";

  it("usa os endereços reais da Meta quando ninguém mexe", () => {
    const env = readApiEnv(api);
    expect(env.META_AUTH_URL).toBe("https://www.instagram.com");
    expect(env.META_TOKEN_URL).toBe("https://api.instagram.com");
    expect(env.META_GRAPH_URL).toBe("https://graph.instagram.com");
  });

  it("deixa o teste apontar para a Meta falsa", () => {
    const env = readApiEnv({ ...api, NODE_ENV: "test", META_GRAPH_URL: OUTRO });
    expect(env.META_GRAPH_URL).toBe(OUTRO);
  });

  it.each(["META_AUTH_URL", "META_TOKEN_URL", "META_GRAPH_URL"])(
    "impede a API de subir com %s trocada fora do teste",
    (variavel) => {
      expect(() => readApiEnv({ ...api, NODE_ENV: "production", [variavel]: OUTRO })).toThrow(
        /só pode ser trocada com NODE_ENV=test/,
      );
    },
  );

  it("impede o worker de subir com o endereço trocado fora do teste", () => {
    expect(() => readWorkerEnv({ ...base, NODE_ENV: "development", META_GRAPH_URL: OUTRO })).toThrow(
      /só pode ser trocada com NODE_ENV=test/,
    );
  });

  it("a mensagem do erro traz o nome da variável, nunca o valor", () => {
    try {
      readApiEnv({ ...api, NODE_ENV: "production", META_GRAPH_URL: OUTRO });
      throw new Error("deveria ter recusado");
    } catch (erro) {
      const mensagem = (erro as Error).message;
      expect(mensagem).toContain("META_GRAPH_URL");
      expect(mensagem).not.toContain(OUTRO);
    }
  });
});
