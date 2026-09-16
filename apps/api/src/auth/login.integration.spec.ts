import { createTestUser, TEST_PASSWORD } from "../common/testing/factories";
import { bootTestApp, type TestApp } from "../common/testing/test-app";

/**
 * O login, de ponta a ponta (ADR 0013, seções 2 e 5).
 * Cobre os marcos 5, 6 e 7 da Fase 0 (docs/12).
 */
describe("POST /auth/login", () => {
  let api: TestApp;
  const IP = "203.0.113.10";

  beforeAll(async () => {
    api = await bootTestApp();
  });
  beforeEach(() => api.reset());
  afterAll(() => api.close());

  const login = (email: string, password: string, ip = IP) =>
    api.request({ method: "POST", url: "/auth/login", payload: { email, password }, ip });

  it("dá a MESMA resposta para e-mail inexistente e para senha errada", async () => {
    const user = await createTestUser(api.db, api.config.encryptionKey);

    const inexistente = await login("ninguem@exemplo.com", "qualquer-senha-123");
    const senhaErrada = await login(user.email, "senha-errada-mesmo-123");

    expect(inexistente.statusCode).toBe(401);
    expect(senhaErrada.statusCode).toBe(inexistente.statusCode);
    expect(senhaErrada.body).toEqual(inexistente.body);
    expect(inexistente.body).toEqual({ code: "INVALID_CREDENTIALS", message: "E-mail ou senha incorretos" });
  });

  it("senha certa cria um desafio e NENHUMA sessão", async () => {
    const user = await createTestUser(api.db, api.config.encryptionKey);

    const resposta = await login(user.email, TEST_PASSWORD);

    expect(resposta.statusCode).toBe(200);
    expect(resposta.body).toMatchObject({ purpose: "VERIFY_2FA" });
    expect(typeof resposta.body["token"]).toBe("string");
    expect(await api.db.session.count()).toBe(0);
    expect(await api.db.loginChallenge.count({ where: { userId: user.id } })).toBe(1);
  });

  it("quem ainda não cadastrou as duas etapas recebe o desafio de cadastro", async () => {
    const user = await createTestUser(api.db, api.config.encryptionKey, { withTotp: false });
    const resposta = await login(user.email, TEST_PASSWORD);
    expect(resposta.body).toMatchObject({ purpose: "SETUP_2FA" });
  });

  it("o desafio é guardado só como hash — o token não aparece no banco", async () => {
    const user = await createTestUser(api.db, api.config.encryptionKey);
    const resposta = await login(user.email, TEST_PASSWORD);

    const challenge = await api.db.loginChallenge.findFirstOrThrow({ where: { userId: user.id } });
    expect(challenge.tokenHash).not.toBe(resposta.body["token"]);
    expect(challenge.tokenHash).toHaveLength(64);
  });

  it("nunca registra a senha tentada", async () => {
    const user = await createTestUser(api.db, api.config.encryptionKey);
    const senha = "uma-senha-muito-caracteristica-123";
    await login(user.email, senha);

    const tentativas = await api.db.accessAttempt.findMany();
    expect(tentativas).toHaveLength(1);
    expect(JSON.stringify(tentativas)).not.toContain(senha);
    expect(tentativas[0]).toMatchObject({ email: user.email, ip: IP, result: "WRONG_PASSWORD" });
  });

  it("conta desativada só é revelada depois da senha certa", async () => {
    const user = await createTestUser(api.db, api.config.encryptionKey, { deactivated: true });

    const comSenhaErrada = await login(user.email, "senha-errada-123456");
    const comSenhaCerta = await login(user.email, TEST_PASSWORD);

    expect(comSenhaErrada.body).toMatchObject({ code: "INVALID_CREDENTIALS" });
    expect(comSenhaCerta.statusCode).toBe(403);
    expect(comSenhaCerta.body).toMatchObject({ code: "ACCOUNT_DEACTIVATED" });
  });

  describe("o IP registrado", () => {
    it("vem só de X-Real-IP; um X-Forwarded-For falso é ignorado (marco 10)", async () => {
      const user = await createTestUser(api.db, api.config.encryptionKey);

      await api.request({
        method: "POST",
        url: "/auth/login",
        payload: { email: user.email, password: "errada-de-proposito-1" },
        ip: IP,
        headers: { "x-forwarded-for": "198.51.100.66, 203.0.113.99" },
      });

      const tentativa = await api.db.accessAttempt.findFirstOrThrow();
      expect(tentativa.ip).toBe(IP);
      expect(tentativa.ip).not.toContain("198.51.100.66");
    });

    it("sem X-Real-IP, não inventa um IP a partir de outro cabeçalho", async () => {
      const user = await createTestUser(api.db, api.config.encryptionKey);

      await api.request({
        method: "POST",
        url: "/auth/login",
        payload: { email: user.email, password: "errada-de-proposito-2" },
        headers: { "x-forwarded-for": "198.51.100.66" },
      });

      const tentativa = await api.db.accessAttempt.findFirstOrThrow();
      expect(tentativa.ip).toBe("desconhecido");
    });
  });

  describe("bloqueio por tentativas", () => {
    it("bloqueia a conta na décima falha, e a décima primeira já vem recusada", async () => {
      const user = await createTestUser(api.db, api.config.encryptionKey);

      for (let tentativa = 0; tentativa < 10; tentativa += 1) {
        const resposta = await login(user.email, `errada-${tentativa}-123456`);
        expect(resposta.statusCode).toBe(401);
      }

      // A décima primeira, AINDA QUE COM A SENHA CERTA, encontra o bloqueio:
      // acertar a senha não fura bloqueio ativo.
      const depois = await login(user.email, TEST_PASSWORD);
      expect(depois.statusCode).toBe(429);
      expect(depois.body).toMatchObject({ code: "ACCESS_BLOCKED" });
      expect(typeof depois.body["blockedUntil"]).toBe("string");

      const bloqueio = await api.db.accessBlock.findFirstOrThrow({ where: { type: "ACCOUNT", key: user.email } });
      expect(bloqueio.level).toBe(1);
      const minutos = (bloqueio.until.getTime() - Date.now()) / 60000;
      expect(minutos).toBeGreaterThan(14);
      expect(minutos).toBeLessThanOrEqual(15);
    });

    it("o bloqueio de uma conta não atinge outra conta do mesmo IP antes do limite de IP", async () => {
      const alvo = await createTestUser(api.db, api.config.encryptionKey);
      const outro = await createTestUser(api.db, api.config.encryptionKey);

      for (let tentativa = 0; tentativa < 10; tentativa += 1) await login(alvo.email, `errada-${tentativa}-123456`);

      const resposta = await login(outro.email, TEST_PASSWORD);
      expect(resposta.statusCode).toBe(200);
    });

    it("e-mail inexistente conta no IP, e vinte falhas bloqueiam o IP", async () => {
      for (let tentativa = 0; tentativa < 20; tentativa += 1) {
        await login(`ninguem-${tentativa}@exemplo.com`, "qualquer-senha-123");
      }

      const bloqueio = await api.db.accessBlock.findFirstOrThrow({ where: { type: "IP", key: IP } });
      expect(bloqueio.level).toBe(1);
      // Nenhum bloqueio de conta: ninguém errou a senha da própria conta.
      expect(await api.db.accessBlock.count({ where: { type: "ACCOUNT" } })).toBe(0);
    });
  });
});
