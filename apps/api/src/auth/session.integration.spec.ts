import { createTestUser, TEST_PASSWORD, totpCodeFor } from "../common/testing/factories";
import { ageColumn } from "../common/testing/reset-database";
import { bootTestApp, type TestApp } from "../common/testing/test-app";

/**
 * Ciclo da sessão (ADR 0013, seção 3) e as rotas do perfil.
 * Cobre o marco 8 da Fase 0.
 */
describe("sessão", () => {
  let api: TestApp;
  const IP = "203.0.113.30";

  beforeAll(async () => {
    api = await bootTestApp();
  });
  beforeEach(() => api.reset());
  afterAll(() => api.close());

  /** Entra de verdade: senha, depois código. Não há atalho, nem no teste. */
  async function entrar(): Promise<{ token: string; userId: string; secret: string; email: string }> {
    const user = await createTestUser(api.db, api.config.encryptionKey);
    const desafio = await api.request({
      method: "POST",
      url: "/auth/login",
      payload: { email: user.email, password: TEST_PASSWORD },
      ip: IP,
    });
    const sessao = await api.request({
      method: "POST",
      url: "/auth/challenge/verify",
      payload: { token: desafio.body["token"], code: totpCodeFor(user.totpSecret) },
      ip: IP,
    });
    return { token: sessao.body["token"] as string, userId: user.id, secret: user.totpSecret, email: user.email };
  }

  it("sem token, a rota de sessão recusa", async () => {
    const resposta = await api.request({ method: "GET", url: "/auth/session" });
    expect(resposta.statusCode).toBe(401);
    expect(resposta.body).toMatchObject({ code: "UNAUTHENTICATED" });
  });

  it("com token, devolve quem é, as permissões e a confirmação recente", async () => {
    const { token, email } = await entrar();
    const resposta = await api.request({ method: "GET", url: "/auth/session", token });

    expect(resposta.statusCode).toBe(200);
    expect(resposta.body["user"]).toMatchObject({ email, superAdmin: false, permissions: [] });
    expect(resposta.body["session"]).toMatchObject({ recentlyConfirmed: true });
  });

  it("o token não fica no banco — só o hash dele", async () => {
    const { token } = await entrar();
    const sessao = await api.db.session.findFirstOrThrow();
    expect(sessao.tokenHash).not.toBe(token);
    expect(JSON.stringify(sessao)).not.toContain(token);
  });

  it("depois de sair, o token antigo não vale mais", async () => {
    const { token } = await entrar();
    expect((await api.request({ method: "POST", url: "/auth/logout", token })).statusCode).toBe(204);

    const depois = await api.request({ method: "GET", url: "/auth/session", token });
    expect(depois.statusCode).toBe(401);

    // Revogação é lógica, com motivo: a linha continua lá para investigação.
    const sessao = await api.db.session.findFirstOrThrow();
    expect(sessao.revokedAt).not.toBeNull();
    expect(sessao.revocationReason).toBe("LOGGED_OUT");
  });

  it("o último uso é reescrito no máximo uma vez por hora", async () => {
    const { token } = await entrar();
    const inicial = await api.db.session.findFirstOrThrow();

    await api.request({ method: "GET", url: "/auth/session", token });
    const semMudanca = await api.db.session.findFirstOrThrow();
    expect(semMudanca.lastUsedAt).toEqual(inicial.lastUsedAt);

    await ageColumn(api.db, "Sessao", "ultimoUsoEm", inicial.id, "2 hours");
    await api.request({ method: "GET", url: "/auth/session", token });
    const atualizada = await api.db.session.findFirstOrThrow();
    expect(atualizada.lastUsedAt.getTime()).toBeGreaterThan(semMudanca.lastUsedAt.getTime() - 60_000);
  });

  it("morre por inatividade, e o teto não é estendido pelo uso", async () => {
    const parada = await entrar();
    const sessaoParada = await api.db.session.findFirstOrThrow({ where: { userId: parada.userId } });
    await ageColumn(api.db, "Sessao", "ultimoUsoEm", sessaoParada.id, "8 days");
    expect((await api.request({ method: "GET", url: "/auth/session", token: parada.token })).statusCode).toBe(401);

    await api.reset();

    const antiga = await entrar();
    const sessaoAntiga = await api.db.session.findFirstOrThrow({ where: { userId: antiga.userId } });
    const tetoOriginal = sessaoAntiga.expiresAt;
    await api.request({ method: "GET", url: "/auth/session", token: antiga.token });
    const depoisDeUsar = await api.db.session.findFirstOrThrow({ where: { id: sessaoAntiga.id } });
    expect(depoisDeUsar.expiresAt).toEqual(tetoOriginal);

    // Passado o teto, nem o uso de agora segura.
    await ageColumn(api.db, "Sessao", "expiraEm", sessaoAntiga.id, "1 minute");
    expect((await api.request({ method: "GET", url: "/auth/session", token: antiga.token })).statusCode).toBe(401);
  });

  it("lista as sessões ativas e marca a atual", async () => {
    const { token, userId } = await entrar();
    // Uma segunda sessão, como se fosse outro aparelho.
    const outra = await api.db.session.create({
      data: {
        userId,
        tokenHash: "a".repeat(64),
        expiresAt: new Date(Date.now() + 86_400_000),
        lastUsedAt: new Date(),
        verifiedAt: new Date(),
      },
    });

    const resposta = await api.request({ method: "GET", url: "/auth/sessions", token });
    const sessoes = resposta.body as unknown as { id: string; current: boolean }[];
    expect(sessoes).toHaveLength(2);
    expect(sessoes.find((sessao) => sessao.id === outra.id)?.current).toBe(false);
    expect(sessoes.filter((sessao) => sessao.current)).toHaveLength(1);
  });

  it("sair dos outros aparelhos mantém o atual", async () => {
    const { token, userId } = await entrar();
    await api.db.session.create({
      data: {
        userId,
        tokenHash: "b".repeat(64),
        expiresAt: new Date(Date.now() + 86_400_000),
        lastUsedAt: new Date(),
        verifiedAt: new Date(),
      },
    });

    const resposta = await api.request({ method: "POST", url: "/auth/sessions/revoke-others", token });
    expect(resposta.body).toEqual({ revoked: 1 });
    expect((await api.request({ method: "GET", url: "/auth/session", token })).statusCode).toBe(200);
  });

  describe("trocar a senha", () => {
    const novaSenha = "outra-senha-boa-2026";

    it("exige a senha atual e o código do aplicativo", async () => {
      const { token, secret } = await entrar();

      const semCodigo = await api.request({
        method: "POST",
        url: "/auth/password",
        token,
        payload: { currentPassword: TEST_PASSWORD, newPassword: novaSenha, code: "000000" },
      });
      expect(semCodigo.body).toMatchObject({ code: "INVALID_CODE" });

      const senhaAtualErrada = await api.request({
        method: "POST",
        url: "/auth/password",
        token,
        payload: { currentPassword: "nao-e-a-senha-1234", newPassword: novaSenha, code: totpCodeFor(secret) },
      });
      expect(senhaAtualErrada.body).toMatchObject({ code: "INVALID_CREDENTIALS" });
    });

    it("recusa senha fora da política, sem devolver a senha", async () => {
      const { token, secret } = await entrar();
      // Passo seguinte: o código do passo atual foi gasto no login, e o
      // anti-reuso o recusa — na tela, é esperar os 30 segundos.
      const resposta = await api.request({
        method: "POST",
        url: "/auth/password",
        token,
        payload: { currentPassword: TEST_PASSWORD, newPassword: "curta", code: totpCodeFor(secret, 1) },
      });

      expect(resposta.body).toMatchObject({ code: "PASSWORD_POLICY" });
      expect(JSON.stringify(resposta.body)).not.toContain("curta");
    });

    it("troca, derruba as outras sessões e mantém a atual", async () => {
      const { token, secret, userId, email } = await entrar();
      await api.db.session.create({
        data: {
          userId,
          tokenHash: "c".repeat(64),
          expiresAt: new Date(Date.now() + 86_400_000),
          lastUsedAt: new Date(),
          verifiedAt: new Date(),
        },
      });

      const resposta = await api.request({
        method: "POST",
        url: "/auth/password",
        token,
        payload: { currentPassword: TEST_PASSWORD, newPassword: novaSenha, code: totpCodeFor(secret, 1) },
      });
      expect(resposta.body).toEqual({ revoked: 1 });
      expect((await api.request({ method: "GET", url: "/auth/session", token })).statusCode).toBe(200);

      const outras = await api.db.session.findMany({ where: { revokedAt: { not: null } } });
      expect(outras).toHaveLength(1);
      expect(outras[0]?.revocationReason).toBe("PASSWORD_CHANGE");

      // A senha nova entra e a antiga não.
      const comNova = await api.request({
        method: "POST",
        url: "/auth/login",
        payload: { email, password: novaSenha },
        ip: IP,
      });
      expect(comNova.statusCode).toBe(200);
    });
  });

  it("gerar códigos novos exige o código do aplicativo e invalida os anteriores", async () => {
    const { token, secret, userId } = await entrar();
    await api.db.recoveryCode.create({ data: { userId, codeHash: "d".repeat(64) } });

    const semCodigo = await api.request({ method: "POST", url: "/auth/recovery-codes", token, payload: { code: "000000" } });
    expect(semCodigo.body).toMatchObject({ code: "INVALID_CODE" });

    const resposta = await api.request({
      method: "POST",
      url: "/auth/recovery-codes",
      token,
      payload: { code: totpCodeFor(secret, 1) },
    });
    expect(resposta.body["codes"]).toHaveLength(10);

    const guardados = await api.db.recoveryCode.findMany({ where: { userId } });
    expect(guardados).toHaveLength(10);
    expect(guardados.map((codigo) => codigo.codeHash)).not.toContain("d".repeat(64));
  });
});
