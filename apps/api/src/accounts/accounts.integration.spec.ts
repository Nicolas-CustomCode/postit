import { createTestAccount, createTestUser, TEST_PASSWORD, totpCodeFor } from "../common/testing/factories";
import { bootTestApp, type TestApp } from "../common/testing/test-app";

/**
 * Listagem de contas conectadas (RF-A01, RF-A09).
 *
 * O teste mais importante deste arquivo é o último: o token não sai daqui.
 */
describe("GET /accounts", () => {
  let api: TestApp;

  beforeAll(async () => {
    api = await bootTestApp();
  });
  beforeEach(() => api.reset());
  afterAll(() => api.close());

  /** Entra de verdade: senha e código. Não há atalho, nem no teste. */
  async function sessionToken(): Promise<string> {
    const user = await createTestUser(api.db, api.config.encryptionKey);
    const desafio = await api.request({
      method: "POST",
      url: "/auth/login",
      payload: { email: user.email, password: TEST_PASSWORD },
      ip: "203.0.113.50",
    });
    const sessao = await api.request({
      method: "POST",
      url: "/auth/challenge/verify",
      payload: { token: desafio.body["token"], code: totpCodeFor(user.totpSecret) },
      ip: "203.0.113.50",
    });
    return sessao.body["token"] as string;
  }

  it("recusa quem não está logado", async () => {
    const resposta = await api.request({ method: "GET", url: "/accounts" });
    expect(resposta.statusCode).toBe(401);
  });

  it("devolve lista vazia quando não há nenhuma conta conectada", async () => {
    const token = await sessionToken();
    const resposta = await api.request({ method: "GET", url: "/accounts", token });

    expect(resposta.statusCode).toBe(200);
    expect(resposta.body).toEqual([]);
  });

  it("lista as contas em ordem de @, com o endereço público da foto", async () => {
    const token = await sessionToken();
    await createTestAccount(api.db, api.config.encryptionKey, { username: "zeta.loja" });
    await createTestAccount(api.db, api.config.encryptionKey, {
      username: "alfa.loja",
      name: "Alfa",
      photoObjectKey: "publicas/contas/alfa/foto.jpg",
    });

    const contas = (await api.request({ method: "GET", url: "/accounts", token })).body as unknown as {
      username: string;
      name: string | null;
      photoUrl: string | null;
      timezone: string;
      warning: string | null;
    }[];

    expect(contas.map((conta) => conta.username)).toEqual(["alfa.loja", "zeta.loja"]);
    expect(contas[0]).toMatchObject({
      name: "Alfa",
      timezone: "America/Sao_Paulo",
      warning: null,
      photoUrl: expect.stringContaining("/publicas/contas/alfa/foto.jpg"),
    });
    // Sem foto copiada ainda, a tela desenha as iniciais.
    expect(contas[1]?.photoUrl).toBeNull();
  });

  it("não lista conta desativada", async () => {
    const token = await sessionToken();
    await createTestAccount(api.db, api.config.encryptionKey, { active: false });

    expect((await api.request({ method: "GET", url: "/accounts", token })).body).toEqual([]);
  });

  it("avisa quando o token está perto de vencer, e quando já venceu", async () => {
    const token = await sessionToken();
    const dias = (n: number) => new Date(Date.now() + n * 24 * 60 * 60 * 1000);
    await createTestAccount(api.db, api.config.encryptionKey, { username: "a.vencida", tokenExpiresAt: dias(-1) });
    await createTestAccount(api.db, api.config.encryptionKey, { username: "b.vencendo", tokenExpiresAt: dias(3) });
    await createTestAccount(api.db, api.config.encryptionKey, { username: "c.tranquila", tokenExpiresAt: dias(40) });

    const contas = (await api.request({ method: "GET", url: "/accounts", token })).body as unknown as {
      username: string;
      warning: string | null;
    }[];

    expect(contas.map((conta) => [conta.username, conta.warning])).toEqual([
      ["a.vencida", "TOKEN_EXPIRED"],
      ["b.vencendo", "TOKEN_EXPIRING"],
      ["c.tranquila", null],
    ]);
  });

  it("nunca devolve o token, nem o nome da coluna dele", async () => {
    const token = await sessionToken();
    await createTestAccount(api.db, api.config.encryptionKey);

    const resposta = await api.request({ method: "GET", url: "/accounts", token });
    const cru = JSON.stringify(resposta.body);

    // O token guardado, cifrado, e qualquer campo com "token" no nome além da
    // expiração — é assim que `tokenCifrado` chegaria à tela por descuido.
    const guardado = await api.db.account.findFirstOrThrow();
    expect(cru).not.toContain(guardado.tokenEncrypted);
    expect(cru).not.toContain("tokenEncrypted");
    expect(cru).not.toContain("tokenCifrado");
    expect(cru).not.toContain("scopes");
    expect(cru).toContain("tokenExpiresAt");
  });
});
