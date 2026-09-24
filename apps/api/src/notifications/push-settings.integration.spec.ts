import { createTestUser, TEST_PASSWORD, totpCodeFor } from "../common/testing/factories";
import { bootTestApp, type TestApp } from "../common/testing/test-app";

/**
 * O que cada pessoa decide sobre o próprio push (RF-J02, RF-J04): inscrever o
 * aparelho, desativar, pedir teste e escolher os tipos.
 *
 * O ponto que o banco de verdade prova: a inscrição nasce **presa à sessão** que a
 * criou — é o que faz o push parar ao sair do PostIt.
 */
describe("preferências e inscrições de push", () => {
  let api: TestApp;
  const IP = "203.0.113.93";

  beforeAll(async () => {
    api = await bootTestApp();
  });
  beforeEach(() => api.reset());
  afterAll(() => api.close());

  interface Pessoa {
    readonly token: string;
    readonly userId: string;
  }

  async function entrar(): Promise<Pessoa> {
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
    return { token: sessao.body["token"] as string, userId: user.id };
  }

  const inscricao = (endpoint = "https://fcm.googleapis.com/fcm/send/aparelho-1") => ({
    endpoint,
    keys: { p256dh: "B".repeat(87), auth: "a".repeat(22) },
  });

  const post = (pessoa: Pessoa, url: string, payload: unknown) =>
    api.request({ method: "POST", url, payload: payload as Record<string, unknown>, token: pessoa.token });

  it("inscrever prende a inscrição à sessão atual", async () => {
    const ana = await entrar();

    const resposta = await post(ana, "/notifications/push-subscriptions", inscricao());

    expect(resposta.statusCode).toBe(204);
    const salva = await api.db.pushSubscription.findUniqueOrThrow({ where: { endpoint: inscricao().endpoint } });
    const sessao = await api.db.session.findFirstOrThrow({ where: { userId: ana.userId, revokedAt: null } });
    expect(salva).toMatchObject({ userId: ana.userId, sessionId: sessao.id, consecutiveFailures: 0 });
  });

  it("o mesmo navegador com outra pessoa logada passa a inscrição para quem entrou", async () => {
    const ana = await entrar();
    const bruno = await entrar();
    await post(ana, "/notifications/push-subscriptions", inscricao());

    await post(bruno, "/notifications/push-subscriptions", inscricao());

    expect(await api.db.pushSubscription.count()).toBe(1);
    expect((await api.db.pushSubscription.findFirstOrThrow()).userId).toBe(bruno.userId);
  });

  it("recusa endereço sem https, e a resposta não ecoa o endereço", async () => {
    const ana = await entrar();

    const resposta = await post(ana, "/notifications/push-subscriptions", inscricao("http://exemplo.com/push/segredo"));

    expect(resposta.statusCode).toBe(400);
    expect(JSON.stringify(resposta.body)).not.toContain("segredo");
  });

  it("desativar só apaga a própria, e é idempotente", async () => {
    const ana = await entrar();
    const bruno = await entrar();
    await post(ana, "/notifications/push-subscriptions", inscricao());

    const doOutro = await post(bruno, "/notifications/push-subscriptions/remove", { endpoint: inscricao().endpoint });
    expect(doOutro.statusCode).toBe(204);
    expect(await api.db.pushSubscription.count()).toBe(1);

    await post(ana, "/notifications/push-subscriptions/remove", { endpoint: inscricao().endpoint });
    const deNovo = await post(ana, "/notifications/push-subscriptions/remove", { endpoint: inscricao().endpoint });
    expect(deNovo.statusCode).toBe(204);
    expect(await api.db.pushSubscription.count()).toBe(0);
  });

  it("o teste marca a própria inscrição; a de outra pessoa responde 404", async () => {
    const ana = await entrar();
    const bruno = await entrar();
    await post(ana, "/notifications/push-subscriptions", inscricao());

    const alheio = await post(bruno, "/notifications/push-subscriptions/test", { endpoint: inscricao().endpoint });
    expect(alheio.statusCode).toBe(404);
    expect((await api.db.pushSubscription.findFirstOrThrow()).testRequestedAt).toBeNull();

    const proprio = await post(ana, "/notifications/push-subscriptions/test", { endpoint: inscricao().endpoint });
    expect(proprio.statusCode).toBe(204);
    expect((await api.db.pushSubscription.findFirstOrThrow()).testRequestedAt).not.toBeNull();
  });

  describe("preferências", () => {
    it("sem escolha nenhuma, os quatro tipos vêm ligados", async () => {
      const ana = await entrar();

      const resposta = await api.request({ method: "GET", url: "/notifications/preferences", token: ana.token });

      expect(resposta.body).toEqual([
        { type: "PUBLISH_FAILED", push: true },
        { type: "ACCOUNT_ACCESS_LOST", push: true },
        { type: "AWAITING_APPROVAL", push: true },
        { type: "POST_REJECTED", push: true },
      ]);
    });

    it("desligar um tipo vale só para quem escolheu, e ligar de novo volta", async () => {
      const ana = await entrar();
      const bruno = await entrar();

      await post(ana, "/notifications/preferences", { type: "AWAITING_APPROVAL", push: false });
      const lida = await api.request({ method: "GET", url: "/notifications/preferences", token: ana.token });
      const doOutro = await api.request({ method: "GET", url: "/notifications/preferences", token: bruno.token });

      expect(lida.body).toContainEqual({ type: "AWAITING_APPROVAL", push: false });
      expect(doOutro.body).toContainEqual({ type: "AWAITING_APPROVAL", push: true });

      await post(ana, "/notifications/preferences", { type: "AWAITING_APPROVAL", push: true });
      expect(await api.db.notificationPreference.count()).toBe(1);
    });

    it("tipo que o sino não gera é recusado", async () => {
      const ana = await entrar();
      const resposta = await post(ana, "/notifications/preferences", { type: "ACCOUNT_LOCKED", push: false });
      expect(resposta.statusCode).toBe(400);
    });
  });
});
