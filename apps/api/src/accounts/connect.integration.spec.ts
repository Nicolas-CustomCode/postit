import { createHmac } from "node:crypto";
import type { FastifyInstance } from "fastify";
import { decryptSecret } from "../common/crypto";
import {
  createFakeMeta,
  FAKE_META_ACCOUNT,
  FAKE_META_CODES,
  FAKE_META_REDIRECT_URI,
  FAKE_META_SECOND_ACCOUNT,
} from "../fake-meta/fake-meta";
import { createTestUser, TEST_PASSWORD, totpCodeFor } from "../common/testing/factories";
import { bootTestApp, type TestApp } from "../common/testing/test-app";
import { StorageService } from "../storage/storage.service";

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
  /** O endereço da Meta falsa, guardado para quem precisa subir uma segunda API. */
  let metaBase = "";
  const IP = "203.0.113.70";

  beforeAll(async () => {
    meta = createFakeMeta("test");
    await meta.listen({ port: 0, host: "127.0.0.1" });
    const endereco = meta.addresses()[0];
    const base = `http://127.0.0.1:${endereco?.port ?? 0}`;
    metaBase = base;

    api = await bootTestApp({
      META_AUTH_URL: base,
      META_TOKEN_URL: base,
      META_GRAPH_URL: base,
      IG_APP_ID: "app-de-teste",
      IG_APP_SECRET: "segredo-de-teste",
      IG_REDIRECT_URI: FAKE_META_REDIRECT_URI,
    });
  });
  /**
   * Apaga do MinIO as fotos copiadas: toda conexão bem-sucedida grava uma.
   *
   * Vai pelas contas que ainda estão no banco, e nunca varre `publicas/contas/`
   * inteiro — o teste divide o bucket com o desenvolvimento, e varrer apagaria a
   * foto de uma conta de verdade.
   */
  async function limparFotos(): Promise<void> {
    const contas = await api.db.account.findMany({
      where: { photoObjectKey: { not: null } },
      select: { photoObjectKey: true },
    });
    const storage = api.app.get(StorageService);
    for (const { photoObjectKey } of contas) {
      if (photoObjectKey !== null) await storage.removePublic(photoObjectKey).catch(() => undefined);
    }
  }

  beforeEach(async () => {
    await limparFotos();
    await api.reset();
  });
  afterAll(async () => {
    await limparFotos();
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

  /*
   * A foto vai para o nosso armazenamento na hora de conectar (docs/08). A tela
   * nunca carrega imagem da Meta: a CSP não libera domínio de terceiro, e o
   * endereço que a Meta dá é assinado e vence.
   *
   * O nome do objeto é aleatório e não carrega nada da conta — quem souber a URL
   * lê o arquivo, então o nome é a única proteção (docs/11).
   */
  it("copia a foto de perfil para o nosso armazenamento", async () => {
    const token = await entrar();
    const state = await comecar(token);

    await concluir(token, FAKE_META_CODES.ok, state);

    const conta = await api.db.account.findFirstOrThrow();
    expect(conta.photoObjectKey).toMatch(/^publicas\/contas\/[0-9a-f]{32}\.png$/);
    expect(conta.photoObjectKey).not.toContain(FAKE_META_ACCOUNT.username);
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

  /*
   * A exceção à regra de cima: a conta que perdeu o acesso precisa reconectar, e é
   * o que o botão da postagem que falhou por token oferece (docs/09).
   */
  it("conta ativa sem acesso reconecta: token novo, sinal apagado, mesma linha", async () => {
    const token = await entrar();
    await concluir(token, FAKE_META_CODES.ok, await comecar(token));
    const antes = await api.db.account.update({
      where: { network_externalId: { network: "INSTAGRAM", externalId: FAKE_META_ACCOUNT.user_id } },
      data: { accessLostAt: new Date(), tokenEncrypted: "v1:token-velho" },
    });

    const resposta = await concluir(token, FAKE_META_CODES.ok, await comecar(token));

    expect(resposta.statusCode).toBeLessThan(400);
    const depois = await api.db.account.findUniqueOrThrow({ where: { id: antes.id } });
    expect(depois.accessLostAt).toBeNull();
    expect(depois.tokenEncrypted).not.toBe("v1:token-velho");
    expect(await api.db.account.count()).toBe(1);
  });

  it("conta ativa com o token vencendo em poucos dias também reconecta", async () => {
    const token = await entrar();
    await concluir(token, FAKE_META_CODES.ok, await comecar(token));
    await api.db.account.updateMany({ data: { tokenExpiresAt: new Date(Date.now() + 2 * 24 * 60 * 60 * 1000) } });

    const resposta = await concluir(token, FAKE_META_CODES.ok, await comecar(token));

    expect(resposta.statusCode).toBeLessThan(400);
    expect((await api.db.account.findFirstOrThrow()).tokenExpiresAt.getTime()).toBeGreaterThan(
      Date.now() + 50 * 24 * 60 * 60 * 1000,
    );
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

  /**
   * Os erros que a revisão pegou. Todos davam a mensagem errada — e a errada
   * manda a pessoa para o lado oposto do problema.
   */
  describe("recusas que precisam dizer a coisa certa", () => {
    /**
     * Código já usado (F5 na volta), código vencido depois de uma hora, e a URI
     * de retorno diferente da cadastrada no painel. A Meta devolve o MESMO
     * `code: 100` nos três, e todos diziam "o Instagram não respondeu agora" —
     * mandando caçar problema de rede que não existe.
     */
    it("código de autorização inválido diz para recomeçar, não que o Instagram caiu", async () => {
      const token = await entrar();
      const resposta = await concluir(token, "codigo-que-nao-existe", await comecar(token));

      expect(resposta.statusCode).toBe(400);
      expect(resposta.body).toMatchObject({ code: "CONNECTION_INVALID" });
    });

    /**
     * A falha número 1 do mundo real: o painel da Meta acrescenta uma barra
     * final sozinho e a URI deixa de bater caractere a caractere. O docs/12
     * chama isso de risco da fase — e até agora nenhum teste cobria.
     */
    it("URI de retorno diferente da cadastrada diz para recomeçar", async () => {
      const outraApi = await bootTestApp({
        META_AUTH_URL: metaBase,
        META_TOKEN_URL: metaBase,
        META_GRAPH_URL: metaBase,
        IG_APP_ID: "app-de-teste",
        IG_APP_SECRET: "segredo-de-teste",
        // A barra final que o painel acrescenta.
        IG_REDIRECT_URI: `${FAKE_META_REDIRECT_URI}/`,
      });

      try {
        await outraApi.reset();
        const user = await createTestUser(outraApi.db, outraApi.config.encryptionKey, {
          permissions: ["ACCOUNT_MANAGE"],
        });
        const desafio = await outraApi.request({
          method: "POST",
          url: "/auth/login",
          payload: { email: user.email, password: TEST_PASSWORD },
          ip: IP,
        });
        const sessao = await outraApi.request({
          method: "POST",
          url: "/auth/challenge/verify",
          payload: { token: desafio.body["token"], code: totpCodeFor(user.totpSecret) },
          ip: IP,
        });
        const sessionToken = sessao.body["token"] as string;

        const inicio = await outraApi.request({ method: "POST", url: "/accounts/connect", token: sessionToken });
        const state = new URL(inicio.body["authorizationUrl"] as string).searchParams.get("state") ?? "";

        const resposta = await outraApi.request({
          method: "POST",
          url: "/accounts/connect/finish",
          token: sessionToken,
          payload: { code: FAKE_META_CODES.ok, state },
        });

        expect(resposta.statusCode).toBe(400);
        expect(resposta.body).toMatchObject({ code: "CONNECTION_INVALID" });
      } finally {
        await outraApi.close();
      }
    });

    /** `JSON.parse("null")` não lança: o state precisava recusar isso na forma. */
    it("state com corpo nulo é recusado como state inválido, não como erro de servidor", async () => {
      const token = await entrar();
      // Assinado por nós, mas com corpo `null` — só quem tem o segredo chega aqui.
      const corpo = Buffer.from("null", "utf8").toString("base64url");
      const assinatura = createHmac("sha256", Buffer.from(process.env["STATE_SECRET"] ?? "", "hex"))
        .update(corpo)
        .digest("base64url");

      const resposta = await concluir(token, FAKE_META_CODES.ok, `${corpo}.${assinatura}`);

      expect(resposta.statusCode).toBe(400);
      expect(resposta.body).toMatchObject({ code: "CONNECTION_INVALID" });
    });
  });
});
