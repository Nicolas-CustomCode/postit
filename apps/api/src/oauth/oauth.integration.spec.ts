import { createHash, randomBytes } from "node:crypto";
import type { Permission } from "@repo/shared";
import { createTestUser, TEST_PASSWORD, totpCodeFor } from "../common/testing/factories";
import { ageColumn } from "../common/testing/reset-database";
import { bootTestApp, TEST_INTERNAL_KEY, type TestApp } from "../common/testing/test-app";
import { ClientMetadataFetcher } from "./client-metadata.fetcher";

/**
 * O servidor OAuth do assistente, de ponta a ponta (ADR 0029): registro ou CIMD,
 * tela de permissão, troca com PKCE, renovação com rotação e o `/mcp` recusando
 * quem não vale.
 *
 * Nada aqui fala com o ChatGPT (regra 23 no espírito): o teste faz o papel do
 * cliente, e a ficha do CIMD vem de uma busca trocada.
 */
describe("OAuth do assistente", () => {
  let api: TestApp;
  const IP = "203.0.113.40";
  const APP_URL = "https://postit.teste";
  const RETORNO = "https://chatgpt.com/connector_platform_oauth_redirect";
  const FICHA = "https://openai.com/chatgpt.json";

  beforeAll(async () => {
    api = await bootTestApp({ APP_URL });
  });
  afterAll(() => api.close());
  beforeEach(async () => {
    await api.reset();
    jest.restoreAllMocks();
  });

  async function entrar(permissions: readonly Permission[] = ["POST_EDIT"]) {
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
    return { token: sessao.body["token"] as string, userId: user.id };
  }

  function pkce() {
    const verifier = randomBytes(32).toString("base64url");
    return { verifier, challenge: createHash("sha256").update(verifier).digest("base64url") };
  }

  async function registrar(): Promise<string> {
    const resposta = await api.request({
      method: "POST",
      url: "/oauth/register",
      payload: { client_name: "ChatGPT", redirect_uris: [RETORNO], token_endpoint_auth_method: "none" },
    });
    expect(resposta.statusCode).toBe(201);
    return resposta.body["client_id"] as string;
  }

  function pedido(clientId: string, challenge: string, extra: Record<string, string> = {}) {
    return {
      client_id: clientId,
      redirect_uri: RETORNO,
      response_type: "code",
      code_challenge: challenge,
      code_challenge_method: "S256",
      scope: "postagens:compor",
      state: "estado-do-cliente",
      resource: `${APP_URL}/mcp`,
      ...extra,
    };
  }

  /** Autoriza pela tela e devolve o código do retorno. */
  async function autorizar(sessao: string, clientId: string, challenge: string): Promise<string> {
    const resposta = await api.request({
      method: "POST",
      url: "/oauth/approve",
      token: sessao,
      ip: IP,
      payload: pedido(clientId, challenge),
    });
    expect(resposta.statusCode).toBe(200);
    const retorno = new URL(resposta.body["redirectTo"] as string);
    expect(`${retorno.origin}${retorno.pathname}`).toBe(RETORNO);
    expect(retorno.searchParams.get("state")).toBe("estado-do-cliente");
    expect(retorno.searchParams.get("iss")).toBe(APP_URL);
    return retorno.searchParams.get("code")!;
  }

  function trocar(campos: Record<string, string>) {
    return api.request({
      method: "POST",
      url: "/oauth/token",
      payload: new URLSearchParams(campos).toString(),
      headers: { "content-type": "application/x-www-form-urlencoded" },
    });
  }

  async function conectar() {
    const pessoa = await entrar();
    const clientId = await registrar();
    const { verifier, challenge } = pkce();
    const code = await autorizar(pessoa.token, clientId, challenge);
    const tokens = await trocar({
      grant_type: "authorization_code",
      code,
      code_verifier: verifier,
      client_id: clientId,
      redirect_uri: RETORNO,
    });
    expect(tokens.statusCode).toBe(200);
    return {
      pessoa,
      clientId,
      access: tokens.body["access_token"] as string,
      refresh: tokens.body["refresh_token"] as string,
    };
  }

  /**
   * Chamada no protocolo de 2025, sem envelope. A resposta vem em SSE de um evento
   * só — o transporte sem estado do SDK responde assim —, e aqui ela vira JSON.
   */
  async function chamarMcp(token: string | undefined, corpo: object) {
    const resposta = await api.app.inject({
      method: "POST",
      url: "/mcp",
      payload: corpo,
      headers: {
        "x-internal-key": TEST_INTERNAL_KEY,
        accept: "application/json, text/event-stream",
        "content-type": "application/json",
        ...(token === undefined ? {} : { authorization: `Bearer ${token}` }),
      },
    });
    const dados = resposta.body.split("\n").find((linha) => linha.startsWith("data: "));
    const body = (dados === undefined ? resposta.json() : JSON.parse(dados.slice(6))) as Record<string, unknown>;
    return { statusCode: resposta.statusCode, body };
  }

  const LISTAR_CONTAS = {
    jsonrpc: "2.0",
    id: 1,
    method: "tools/call",
    params: { name: "listar_contas", arguments: {} },
  };

  describe("tela de permissão", () => {
    it("descreve o pedido com o nome do cliente e o domínio de retorno", async () => {
      const pessoa = await entrar();
      const clientId = await registrar();
      const resposta = await api.request({
        method: "GET",
        url: `/oauth/requests?${new URLSearchParams(pedido(clientId, pkce().challenge))}`,
        token: pessoa.token,
      });

      expect(resposta.body).toMatchObject({
        kind: "READY",
        clientName: "ChatGPT",
        redirectHost: "chatgpt.com",
        canAuthorize: true,
      });
      const recusa = new URL(resposta.body["denyRedirect"] as string);
      expect(recusa.searchParams.get("error")).toBe("access_denied");
      expect(recusa.searchParams.get("state")).toBe("estado-do-cliente");
    });

    it("retorno que não é do cliente não vira redirecionamento", async () => {
      const pessoa = await entrar();
      const clientId = await registrar();
      const resposta = await api.request({
        method: "GET",
        url: `/oauth/requests?${new URLSearchParams(pedido(clientId, pkce().challenge, { redirect_uri: "https://atacante.exemplo/cb" }))}`,
        token: pessoa.token,
      });
      expect(resposta.body["kind"]).toBe("INVALID");
    });

    it("sem POSTAGEM_EDITAR, a tela só oferece recusar, e a API recusa autorizar", async () => {
      const pessoa = await entrar([]);
      const clientId = await registrar();
      const { challenge } = pkce();
      const descricao = await api.request({
        method: "GET",
        url: `/oauth/requests?${new URLSearchParams(pedido(clientId, challenge))}`,
        token: pessoa.token,
      });
      expect(descricao.body["canAuthorize"]).toBe(false);

      const aprovar = await api.request({
        method: "POST",
        url: "/oauth/approve",
        token: pessoa.token,
        payload: pedido(clientId, challenge),
      });
      expect(aprovar.statusCode).toBe(403);
    });

    it("sem sessão, nem descreve", async () => {
      const clientId = await registrar();
      const resposta = await api.request({
        method: "GET",
        url: `/oauth/requests?${new URLSearchParams(pedido(clientId, pkce().challenge))}`,
      });
      expect(resposta.statusCode).toBe(401);
    });

    it("autorizar grava a auditoria, sem código nem token", async () => {
      const { pessoa } = await conectar();
      const eventos = await api.db.auditEvent.findMany({ where: { action: "ASSISTANT_AUTHORIZED" } });
      expect(eventos).toHaveLength(1);
      expect(eventos[0]).toMatchObject({ authorId: pessoa.userId, details: { cliente: "ChatGPT" } });
    });
  });

  describe("CIMD", () => {
    it("lê a ficha do endereço do client_id e guarda o cliente", async () => {
      const busca = jest
        .spyOn(api.app.get(ClientMetadataFetcher), "fetch")
        .mockResolvedValue({ client_id: FICHA, client_name: "ChatGPT", redirect_uris: [RETORNO] });
      const pessoa = await entrar();

      const resposta = await api.request({
        method: "GET",
        url: `/oauth/requests?${new URLSearchParams(pedido(FICHA, pkce().challenge))}`,
        token: pessoa.token,
      });
      expect(resposta.body).toMatchObject({ kind: "READY", clientName: "ChatGPT" });

      // Dentro do cache, não busca de novo.
      await api.request({
        method: "GET",
        url: `/oauth/requests?${new URLSearchParams(pedido(FICHA, pkce().challenge))}`,
        token: pessoa.token,
      });
      expect(busca).toHaveBeenCalledTimes(1);
      expect(await api.db.oAuthClient.findUnique({ where: { clientId: FICHA } })).toMatchObject({ source: "CIMD" });
    });

    it("ficha que diz ser de outro endereço é recusada", async () => {
      jest
        .spyOn(api.app.get(ClientMetadataFetcher), "fetch")
        .mockResolvedValue({ client_id: "https://atacante.exemplo/ficha.json", redirect_uris: [RETORNO] });
      const pessoa = await entrar();
      const resposta = await api.request({
        method: "GET",
        url: `/oauth/requests?${new URLSearchParams(pedido(FICHA, pkce().challenge))}`,
        token: pessoa.token,
      });
      expect(resposta.body["kind"]).toBe("INVALID");
    });
  });

  describe("troca do código", () => {
    it("PKCE errado não leva token", async () => {
      const pessoa = await entrar();
      const clientId = await registrar();
      const code = await autorizar(pessoa.token, clientId, pkce().challenge);
      const resposta = await trocar({
        grant_type: "authorization_code",
        code,
        code_verifier: pkce().verifier,
        client_id: clientId,
      });
      expect(resposta.statusCode).toBe(400);
      expect(resposta.body).toEqual({ error: "invalid_grant", error_description: expect.any(String) });
    });

    it("o código vale uma vez só", async () => {
      const pessoa = await entrar();
      const clientId = await registrar();
      const { verifier, challenge } = pkce();
      const code = await autorizar(pessoa.token, clientId, challenge);
      const campos = { grant_type: "authorization_code", code, code_verifier: verifier, client_id: clientId };

      expect((await trocar(campos)).statusCode).toBe(200);
      expect((await trocar(campos)).body["error"]).toBe("invalid_grant");
    });

    it("código de outro cliente não serve", async () => {
      const pessoa = await entrar();
      const clientId = await registrar();
      const outro = await registrar();
      const { verifier, challenge } = pkce();
      const code = await autorizar(pessoa.token, clientId, challenge);
      const resposta = await trocar({
        grant_type: "authorization_code",
        code,
        code_verifier: verifier,
        client_id: outro,
      });
      expect(resposta.body["error"]).toBe("invalid_grant");
    });

    it("guarda só o hash dos tokens", async () => {
      const { access, refresh } = await conectar();
      const hashes = (await api.db.oAuthToken.findMany()).map((row) => row.tokenHash);
      expect(hashes).not.toContain(access);
      expect(hashes).not.toContain(refresh);
    });
  });

  describe("renovação", () => {
    it("roda: a nova vale, a velha não", async () => {
      const { clientId, refresh } = await conectar();
      const nova = await trocar({ grant_type: "refresh_token", refresh_token: refresh, client_id: clientId });
      expect(nova.statusCode).toBe(200);
      expect(nova.body["refresh_token"]).not.toBe(refresh);

      const outra = await trocar({
        grant_type: "refresh_token",
        refresh_token: nova.body["refresh_token"] as string,
        client_id: clientId,
      });
      expect(outra.statusCode).toBe(200);
    });

    it("a velha usada de novo derruba a autorização inteira", async () => {
      const { clientId, refresh } = await conectar();
      const nova = await trocar({ grant_type: "refresh_token", refresh_token: refresh, client_id: clientId });

      const reuso = await trocar({ grant_type: "refresh_token", refresh_token: refresh, client_id: clientId });
      expect(reuso.body["error"]).toBe("invalid_grant");

      // Até a renovação legítima, emitida antes do reuso, deixou de valer.
      const legitima = await trocar({
        grant_type: "refresh_token",
        refresh_token: nova.body["refresh_token"] as string,
        client_id: clientId,
      });
      expect(legitima.body["error"]).toBe("invalid_grant");
      expect(await chamarMcp(nova.body["access_token"] as string, LISTAR_CONTAS)).toMatchObject({ statusCode: 401 });

      const grant = await api.db.oAuthGrant.findFirstOrThrow();
      expect(grant.revocationReason).toBe("REFRESH_REUSED");
    });

    it("7 dias sem uso vencem a autorização", async () => {
      const { clientId, refresh } = await conectar();
      const grant = await api.db.oAuthGrant.findFirstOrThrow();
      await ageColumn(api.db, "AutorizacaoOAuth", "ultimoUsoEm", grant.id, "7 days");

      const resposta = await trocar({ grant_type: "refresh_token", refresh_token: refresh, client_id: clientId });
      expect(resposta.body["error"]).toBe("invalid_grant");
    });
  });

  describe("/mcp", () => {
    it("sem token, 401 apontando a descoberta", async () => {
      const resposta = await api.app.inject({
        method: "POST",
        url: "/mcp",
        headers: { "x-internal-key": TEST_INTERNAL_KEY, "content-type": "application/json" },
        payload: LISTAR_CONTAS,
      });
      expect(resposta.statusCode).toBe(401);
      expect(resposta.headers["www-authenticate"]).toBe(
        `Bearer resource_metadata="${APP_URL}/.well-known/oauth-protected-resource"`,
      );
    });

    it("token de sessão não serve como token do assistente", async () => {
      const pessoa = await entrar();
      expect((await chamarMcp(pessoa.token, LISTAR_CONTAS)).statusCode).toBe(401);
    });

    it("com token, a ferramenta responde", async () => {
      const { access } = await conectar();
      const resposta = await chamarMcp(access, LISTAR_CONTAS);
      expect(resposta.statusCode).toBe(200);
      const texto = (resposta.body["result"] as { content: { text: string }[] }).content[0]!.text;
      expect(JSON.parse(texto)).toEqual({ contas: [] });
    });

    it("lista as ferramentas", async () => {
      const { access } = await conectar();
      const resposta = await chamarMcp(access, { jsonrpc: "2.0", id: 2, method: "tools/list", params: {} });
      const nomes = (resposta.body["result"] as { tools: { name: string }[] }).tools.map((tool) => tool.name);
      expect(nomes.sort()).toEqual(["listar_contas", "ver_regras"]);
    });

    it("pessoa desativada perde o acesso na chamada seguinte", async () => {
      const { access, pessoa } = await conectar();
      await api.db.user.update({ where: { id: pessoa.userId }, data: { deactivatedAt: new Date() } });
      expect((await chamarMcp(access, LISTAR_CONTAS)).statusCode).toBe(401);
    });

    it("quem perdeu POSTAGEM_EDITAR perde o assistente na hora", async () => {
      const { access, pessoa } = await conectar();
      await api.db.userPermission.deleteMany({ where: { userId: pessoa.userId } });
      expect((await chamarMcp(access, LISTAR_CONTAS)).statusCode).toBe(403);
    });

    it("autorizar de novo o mesmo cliente derruba a autorização anterior", async () => {
      const primeira = await conectar();
      const { verifier, challenge } = pkce();
      const code = await autorizar(primeira.pessoa.token, primeira.clientId, challenge);
      await trocar({ grant_type: "authorization_code", code, code_verifier: verifier, client_id: primeira.clientId });

      expect((await chamarMcp(primeira.access, LISTAR_CONTAS)).statusCode).toBe(401);
      expect(await api.db.oAuthGrant.count({ where: { revokedAt: null } })).toBe(1);
    });
  });
});
