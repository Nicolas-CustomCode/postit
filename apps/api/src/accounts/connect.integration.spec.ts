import type { FastifyInstance } from "fastify";
import { decryptSecret } from "../common/crypto";
import { createFakeMeta, FAKE_META_ACCOUNT, FAKE_META_CODES, FAKE_META_SECOND_ACCOUNT } from "../fake-meta/fake-meta";
import { createTestUser, TEST_PASSWORD, totpCodeFor } from "../common/testing/factories";
import { bootTestApp, type TestApp } from "../common/testing/test-app";

/**
 * Conectar uma conta do Instagram pelo OAuth (RF-A01, RF-A02).
 *
 * Roda contra a **Meta falsa**, subida aqui mesmo numa porta sorteada pelo
 * sistema (AGENTS.md, regra 23). O código de autorização é o roteiro: cada um
 * leva a Meta falsa a responder um caso diferente.
 *
 * Os dois testes que mais importam: o token nasce cifrado no banco, e nenhuma
 * resposta da API carrega pedaço dele.
 */
describe("conectar conta do Instagram", () => {
  let api: TestApp;
  let meta: FastifyInstance;
  const IP = "203.0.113.70";

  beforeAll(async () => {
    meta = createFakeMeta("test");
    await meta.listen({ port: 0, host: "127.0.0.1" });
    const endereco = meta.addresses()[0];
    const base = `http://127.0.0.1:${endereco?.port ?? 0}`;

    api = await bootTestApp({
      META_AUTH_URL: base,
      META_TOKEN_URL: base,
      META_GRAPH_URL: base,
      IG_APP_ID: "app-de-teste",
      IG_APP_SECRET: "segredo-de-teste",
      IG_REDIRECT_URI: "http://localhost:3010/contas/conectar/retorno",
    });
  });
  beforeEach(() => api.reset());
  afterAll(async () => {
    await api.close();
    await meta.close();
  });

  /** Entra de verdade e devolve o token da sessão, com a permissão de gerenciar. */
  async function entrar(permissions: readonly "ACCOUNT_MANAGE"[] = ["ACCOUNT_MANAGE"]): Promise<string> {
    const user = await createTestUser(api.db, api.config.encryptionKey, { permissions });
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
    return sessao.body["token"] as string;
  }

  /** Começa a conexão e devolve o `state` que a API assinou. */
  async function comecar(token: string): Promise<string> {
    const resposta = await api.request({ method: "POST", url: "/accounts/connect", token });
    expect(resposta.statusCode).toBe(200);

    const url = new URL(resposta.body["authorizationUrl"] as string);
    return url.searchParams.get("state") ?? "";
  }

  const concluir = (token: string, code: string, state: string) =>
    api.request({ method: "POST", url: "/accounts/connect/finish", token, payload: { code, state } });

  it("recusa quem não está logado", async () => {
    expect((await api.request({ method: "POST", url: "/accounts/connect" })).statusCode).toBe(401);
  });

  it("recusa quem não pode gerenciar contas", async () => {
    const token = await entrar([]);
    const resposta = await api.request({ method: "POST", url: "/accounts/connect", token });

    expect(resposta.statusCode).toBe(403);
    expect(resposta.body).toMatchObject({ code: "FORBIDDEN" });
  });

  it("a URL de autorização leva os três escopos, e nenhum a mais", async () => {
    const token = await entrar();
    const resposta = await api.request({ method: "POST", url: "/accounts/connect", token });
    const url = new URL(resposta.body["authorizationUrl"] as string);

    expect(url.searchParams.get("scope")?.split(",")).toEqual([
      "instagram_business_basic",
      "instagram_business_content_publish",
      "instagram_business_manage_insights",
    ]);
    expect(url.searchParams.get("response_type")).toBe("code");
    expect(url.searchParams.get("state")).toBeTruthy();
  });

  it("conecta a conta do começo ao fim", async () => {
    const token = await entrar();
    const state = await comecar(token);

    const resposta = await concluir(token, FAKE_META_CODES.ok, state);

    expect(resposta.statusCode).toBe(200);
    expect(resposta.body).toEqual({ username: FAKE_META_ACCOUNT.username });

    const conta = await api.db.account.findFirstOrThrow();
    expect(conta.externalId).toBe(FAKE_META_ACCOUNT.user_id);
    expect(conta.username).toBe(FAKE_META_ACCOUNT.username);
    expect(conta.timezone).toBe("America/Sao_Paulo");
    expect(conta.active).toBe(true);
    // 60 dias, com folga de um dia para o teste não depender do relógio.
    expect(conta.tokenExpiresAt.getTime()).toBeGreaterThan(Date.now() + 59 * 24 * 60 * 60 * 1000);
  });

  /** Marco 15: o token nasce ilegível, e só a chave certa o abre. */
  it("guarda o token cifrado, nunca em texto puro", async () => {
    const token = await entrar();
    const state = await comecar(token);
    await concluir(token, FAKE_META_CODES.ok, state);

    const conta = await api.db.account.findFirstOrThrow();
    expect(conta.tokenEncrypted).toMatch(/^v1:/);
    expect(conta.tokenEncrypted).not.toContain("fake-long-");

    const aberto = decryptSecret(conta.tokenEncrypted, api.config.encryptionKey, "instagram-token");
    expect(aberto).toContain("fake-long-");
  });

  /** Marco 17, a parte da API: nenhuma resposta carrega pedaço do token. */
  it("o token não aparece em nenhuma resposta", async () => {
    const token = await entrar();
    const state = await comecar(token);
    const conclusao = await concluir(token, FAKE_META_CODES.ok, state);
    const lista = await api.request({ method: "GET", url: "/accounts", token });

    const conta = await api.db.account.findFirstOrThrow();
    const aberto = decryptSecret(conta.tokenEncrypted, api.config.encryptionKey, "instagram-token");

    for (const corpo of [JSON.stringify(conclusao.body), JSON.stringify(lista.body)]) {
      expect(corpo).not.toContain(aberto);
      expect(corpo).not.toContain(conta.tokenEncrypted);
      expect(corpo).not.toContain("fake-long-");
    }
  });

  it("registra a troca pelo token de longa duração na trilha", async () => {
    const token = await entrar();
    const state = await comecar(token);
    await concluir(token, FAKE_META_CODES.ok, state);

    const evento = await api.db.tokenEvent.findFirstOrThrow();
    expect(evento.action).toBe("LONG_LIVED_EXCHANGE");
    expect(evento.result).toBe("SUCCESS");
  });

  /** Marco 14: duas contas convivem, cada uma com o seu token. */
  it("duas contas convivem, com tokens diferentes", async () => {
    const token = await entrar();

    await concluir(token, FAKE_META_CODES.ok, await comecar(token));
    await concluir(token, FAKE_META_CODES.second, await comecar(token));

    const contas = await api.db.account.findMany({ orderBy: { externalId: "asc" } });
    expect(contas).toHaveLength(2);
    expect(contas.map((conta) => conta.username)).toEqual([
      FAKE_META_ACCOUNT.username,
      FAKE_META_SECOND_ACCOUNT.username,
    ]);
    expect(contas[0]?.tokenEncrypted).not.toBe(contas[1]?.tokenEncrypted);
  });

  it("conectar a mesma conta duas vezes é recusado com explicação", async () => {
    const token = await entrar();
    await concluir(token, FAKE_META_CODES.ok, await comecar(token));

    const repetida = await concluir(token, FAKE_META_CODES.ok, await comecar(token));

    expect(repetida.statusCode).toBe(409);
    expect(repetida.body).toMatchObject({ code: "ACCOUNT_ALREADY_CONNECTED" });
    expect(await api.db.account.count()).toBe(1);
  });

  /** Marco 18: conta pessoal em vez de profissional. */
  it("conta pessoal recebe a recusa explicada, e não vira linha no banco", async () => {
    const token = await entrar();
    const resposta = await concluir(token, FAKE_META_CODES.personal, await comecar(token));

    expect(resposta.statusCode).toBe(422);
    expect(resposta.body).toMatchObject({ code: "ACCOUNT_NOT_PROFESSIONAL" });
    expect(await api.db.account.count()).toBe(0);
  });

  /** Marco 19: conta que não aceitou o convite de testadora. */
  it("conta sem convite de testadora recebe a orientação, e não vira linha no banco", async () => {
    const token = await entrar();
    const resposta = await concluir(token, FAKE_META_CODES.notTester, await comecar(token));

    expect(resposta.statusCode).toBe(422);
    expect(resposta.body).toMatchObject({ code: "ACCOUNT_NOT_TESTER" });
    expect(await api.db.account.count()).toBe(0);
  });

  describe("o state", () => {
    it("recusa state adulterado", async () => {
      const token = await entrar();
      const state = await comecar(token);

      const resposta = await concluir(token, FAKE_META_CODES.ok, `${state}x`);
      expect(resposta.statusCode).toBe(400);
      expect(resposta.body).toMatchObject({ code: "CONNECTION_INVALID" });
    });

    it("recusa state sem assinatura", async () => {
      const token = await entrar();
      const resposta = await concluir(token, FAKE_META_CODES.ok, "sem-ponto-nenhum");

      expect(resposta.statusCode).toBe(400);
      expect(resposta.body).toMatchObject({ code: "CONNECTION_INVALID" });
    });

    /**
     * O que o `state` existe para impedir: alguém concluir, na própria sessão,
     * uma autorização que outra pessoa começou.
     */
    it("recusa o state de outra pessoa, mesmo assinado por nós", async () => {
      const deOutra = await comecar(await entrar());
      const minha = await entrar();

      const resposta = await concluir(minha, FAKE_META_CODES.ok, deOutra);

      expect(resposta.statusCode).toBe(400);
      expect(resposta.body).toMatchObject({ code: "CONNECTION_INVALID" });
      expect(await api.db.account.count()).toBe(0);
    });
  });
});
