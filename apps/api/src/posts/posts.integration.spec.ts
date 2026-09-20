import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createTestAccount, createTestUser, TEST_PASSWORD, totpCodeFor } from "../common/testing/factories";
import { bootTestApp, type TestApp } from "../common/testing/test-app";

/**
 * Compor uma postagem, de ponta a ponta (RF-C01, RF-C03, RF-C12; docs/05).
 *
 * Contra o Postgres de verdade: trava otimista, invariante e unicidade não se
 * provam com banco falso — é o que o docs/15 exige justamente aqui.
 */
describe("postagens", () => {
  let api: TestApp;
  const IP = "203.0.113.77";

  beforeAll(async () => {
    api = await bootTestApp();
  });
  beforeEach(() => api.reset());
  afterAll(() => api.close());

  /** Entra de verdade — sem atalho, como manda a regra 11. */
  async function entrar(
    permissions: readonly ("POST_EDIT" | "POST_APPROVE" | "POST_APPROVE_OWN")[] = ["POST_EDIT", "POST_APPROVE", "POST_APPROVE_OWN"],
  ): Promise<{ token: string; userId: string }> {
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

  async function conta(username = "loja.aurora"): Promise<string> {
    const account = await createTestAccount(api.db, api.config.encryptionKey, { username });
    return account.id;
  }

  /** Uma imagem já validada no acervo — o que o envio de mídia produz. */
  async function midia(medidas: { width: number; height: number }): Promise<string> {
    const media = await api.db.media.create({
      data: {
        objectKey: `publicas/postagens/${Math.random().toString(16).slice(2, 10)}.jpg`,
        mimeType: "image/jpeg",
        bytes: 1_000_000,
        width: medidas.width,
        height: medidas.height,
        sha256: "a".repeat(64),
      },
    });
    return media.id;
  }

  async function criar(token: string, accountId: string, caption?: string): Promise<string> {
    const resposta = await api.request({
      method: "POST",
      url: `/accounts/${accountId}/posts`,
      payload: { format: "FEED_IMAGE", ...(caption === undefined ? {} : { caption }) },
      token,
    });

    expect(resposta.statusCode).toBe(201);
    return resposta.body["id"] as string;
  }

  describe("criar e ler", () => {
    it("a postagem nasce em RASCUNHO, sem nenhuma chamada à Meta", async () => {
      const { token, userId } = await entrar();
      const accountId = await conta();

      const postId = await criar(token, accountId, "Primeiro rascunho");
      const detalhe = (
        await api.request({ method: "GET", url: `/accounts/${accountId}/posts/${postId}`, token })
      ).body;

      expect(detalhe).toMatchObject({
        status: "DRAFT",
        format: "FEED_IMAGE",
        caption: "Primeiro rascunho",
        version: 1,
        media: [],
        createdById: userId,
        createdByName: "Pessoa de Teste",
        updatedByName: null,
      });
    });

    it("a lista traz o trecho e a miniatura, mais recente primeiro", async () => {
      const { token } = await entrar();
      const accountId = await conta();

      const primeiro = await criar(token, accountId, "Mais antiga");
      const segundo = await criar(token, accountId, "Mais nova");
      await api.request({
        method: "POST",
        url: `/accounts/${accountId}/posts/${segundo}/media`,
        payload: { version: 1, mediaId: await midia({ width: 1080, height: 1080 }) },
        token,
      });

      const lista = (await api.request({ method: "GET", url: `/accounts/${accountId}/posts`, token }))
        .body as unknown as { id: string; excerpt: string; thumbnailUrl: string | null }[];

      expect(lista.map((item) => item.id)).toEqual([segundo, primeiro]);
      expect(lista[0]?.excerpt).toBe("Mais nova");
      expect(lista[0]?.thumbnailUrl).toMatch(/^https?:\/\/.+\/publicas\/postagens\/.+\.jpg$/);
      expect(lista[1]?.thumbnailUrl).toBeNull();
    });

    it("legenda longa é resumida na lista e vem inteira no detalhe", async () => {
      const { token } = await entrar();
      const accountId = await conta();
      const longa = "a".repeat(500);

      const postId = await criar(token, accountId, longa);

      const lista = (await api.request({ method: "GET", url: `/accounts/${accountId}/posts`, token }))
        .body as unknown as { excerpt: string }[];
      expect(lista[0]?.excerpt).toHaveLength(141); // 140 + reticência

      const detalhe = (
        await api.request({ method: "GET", url: `/accounts/${accountId}/posts/${postId}`, token })
      ).body;
      expect(detalhe["caption"]).toBe(longa);
    });
  });

  /*
   * A regra 24: a API confere que a postagem pertence à conta. O teste varre as
   * rotas do controlador — rota nova sem linha aqui reprova a CI, porque a
   * contagem no fim não fecha.
   */
  describe("uma postagem nunca vaza para outra conta", () => {
    const ROTAS = [
      { method: "GET" as const, caminho: (p: string) => `/${p}`, payload: undefined },
      { method: "POST" as const, caminho: (p: string) => `/${p}/caption`, payload: { version: 1, caption: "x" } },
      { method: "POST" as const, caminho: (p: string) => `/${p}/media`, payload: { version: 1, mediaId: "" } },
      { method: "POST" as const, caminho: (p: string) => `/${p}/ready`, payload: { version: 1 } },
      { method: "POST" as const, caminho: (p: string) => `/${p}/discard`, payload: { version: 1 } },
    ];

    it.each(ROTAS)("$method $caminho responde 404 pela conta errada", async (rota) => {
      const { token } = await entrar();
      const contaA = await conta("conta.a");
      const contaB = await conta("conta.b");
      const postId = await criar(token, contaA);

      const payload =
        rota.payload !== undefined && "mediaId" in rota.payload
          ? { ...rota.payload, mediaId: await midia({ width: 1080, height: 1080 }) }
          : rota.payload;

      const resposta = await api.request({
        method: rota.method,
        url: `/accounts/${contaB}/posts${rota.caminho(postId)}`,
        ...(payload === undefined ? {} : { payload }),
        token,
      });

      expect(resposta.statusCode).toBe(404);
      expect(resposta.body).toMatchObject({ code: "POST_NOT_FOUND" });
    });

    /*
     * O que impede a tabela acima de envelhecer em silêncio: ela é conferida
     * contra o fonte do controlador. Rota nova com `:postId` sem linha aqui
     * reprova a CI — que é o único jeito de a garantia sobreviver a quem
     * escrever a próxima rota daqui a três meses.
     */
    it("a tabela cobre todas as rotas que recebem um id de postagem", () => {
      const fonte = readFileSync(join(__dirname, "posts.controller.ts"), "utf8");
      const rotasNoControlador = fonte.match(/@(?:Get|Post)\("(:postId[^"]*)"\)/g) ?? [];

      expect(rotasNoControlador).toHaveLength(ROTAS.length);
    });
  });

  describe("conflito de edição (RF-C12)", () => {
    it("salvar com versão velha devolve 409 dizendo quem alterou", async () => {
      const { token: tokenA } = await entrar();
      const outro = await createTestUser(api.db, api.config.encryptionKey, {
        name: "Fulano de Tal",
        permissions: ["POST_EDIT"],
      });
      const accountId = await conta();
      const postId = await criar(tokenA, accountId, "Original");

      // A outra pessoa salva primeiro, direto pelo banco — o que importa é a
      // corrida, não o caminho dela.
      await api.db.post.update({
        where: { id: postId },
        data: { caption: "Mexida por Fulano", version: { increment: 1 }, updatedById: outro.id },
      });

      const resposta = await api.request({
        method: "POST",
        url: `/accounts/${accountId}/posts/${postId}/caption`,
        payload: { version: 1, caption: "O que eu estava escrevendo" },
        token: tokenA,
      });

      expect(resposta.statusCode).toBe(409);
      expect(resposta.body).toMatchObject({
        code: "POST_VERSION_CONFLICT",
        conflict: { updatedByName: "Fulano de Tal", version: 2 },
      });

      // E o texto da outra pessoa continua lá: o 409 não escreveu nada.
      const depois = await api.db.post.findUniqueOrThrow({ where: { id: postId } });
      expect(depois.caption).toBe("Mexida por Fulano");
    });

    it("duas gravações simultâneas com a mesma versão: exatamente uma vence", async () => {
      const { token } = await entrar();
      const accountId = await conta();
      const postId = await criar(token, accountId, "Original");

      const salvar = (caption: string) =>
        api.request({
          method: "POST",
          url: `/accounts/${accountId}/posts/${postId}/caption`,
          payload: { version: 1, caption },
          token,
        });

      const [uma, outra] = await Promise.all([salvar("Primeira"), salvar("Segunda")]);
      const status = [uma.statusCode, outra.statusCode].sort();

      expect(status).toEqual([200, 409]);
      expect((await api.db.post.findUniqueOrThrow({ where: { id: postId } })).version).toBe(2);
    });

    it("versão certa numa postagem que não existe é 404, não 409", async () => {
      const { token } = await entrar();
      const accountId = await conta();

      const resposta = await api.request({
        method: "POST",
        url: `/accounts/${accountId}/posts/0199a1b2-c3d4-7000-8000-000000000000/caption`,
        payload: { version: 1, caption: "x" },
        token,
      });

      expect(resposta.statusCode).toBe(404);
    });
  });

  /*
   * I-2, a invariante que impede aprovar uma coisa e publicar outra (RF-E05).
   */
  describe("editar conteúdo derruba a postagem para rascunho", () => {
    async function postagemPronta(): Promise<{ token: string; accountId: string; postId: string }> {
      const { token } = await entrar();
      const accountId = await conta();
      const postId = await criar(token, accountId, "Aprovada assim");

      await api.request({
        method: "POST",
        url: `/accounts/${accountId}/posts/${postId}/media`,
        payload: { version: 1, mediaId: await midia({ width: 1080, height: 1350 }) },
        token,
      });
      const pronta = await api.request({
        method: "POST",
        url: `/accounts/${accountId}/posts/${postId}/ready`,
        payload: { version: 2 },
        token,
      });
      expect(pronta.statusCode).toBe(200);

      return { token, accountId, postId };
    }

    it("mudar a legenda de uma postagem pronta a devolve para rascunho", async () => {
      const { token, accountId, postId } = await postagemPronta();

      const resposta = await api.request({
        method: "POST",
        url: `/accounts/${accountId}/posts/${postId}/caption`,
        payload: { version: 3, caption: "Outra coisa" },
        token,
      });

      expect(resposta.statusCode).toBe(200);
      expect((await api.db.post.findUniqueOrThrow({ where: { id: postId } })).status).toBe("DRAFT");
    });

    it("o rebaixamento fica registrado, com o motivo", async () => {
      const { token, accountId, postId } = await postagemPronta();

      await api.request({
        method: "POST",
        url: `/accounts/${accountId}/posts/${postId}/caption`,
        payload: { version: 3, caption: "Outra coisa" },
        token,
      });

      const registros = await api.db.approval.findMany({ where: { postId }, orderBy: { createdAt: "asc" } });
      expect(registros.map((linha) => linha.action)).toEqual([
        "SUBMITTED_FOR_REVIEW",
        "APPROVED",
        "INVALIDATED_BY_EDIT",
      ]);
    });

    it("trocar a imagem também derruba", async () => {
      const { token, accountId, postId } = await postagemPronta();

      const resposta = await api.request({
        method: "POST",
        url: `/accounts/${accountId}/posts/${postId}/media`,
        payload: { version: 3, mediaId: await midia({ width: 1080, height: 1080 }) },
        token,
      });

      expect(resposta.statusCode).toBe(200);
      expect((await api.db.post.findUniqueOrThrow({ where: { id: postId } })).status).toBe("DRAFT");
      // E ficou uma imagem só: trocar substitui, não acumula.
      expect(await api.db.postMedia.count({ where: { postId } })).toBe(1);
    });
  });

  describe("marcar como pronta", () => {
    it("percorre revisão e aprovação, gravando as duas linhas", async () => {
      const { token, userId } = await entrar();
      const accountId = await conta();
      const postId = await criar(token, accountId, "Pronta para ir");

      await api.request({
        method: "POST",
        url: `/accounts/${accountId}/posts/${postId}/media`,
        payload: { version: 1, mediaId: await midia({ width: 1080, height: 1350 }) },
        token,
      });
      await api.request({
        method: "POST",
        url: `/accounts/${accountId}/posts/${postId}/ready`,
        payload: { version: 2 },
        token,
      });

      expect((await api.db.post.findUniqueOrThrow({ where: { id: postId } })).status).toBe("APPROVED");

      const registros = await api.db.approval.findMany({ where: { postId }, orderBy: { createdAt: "asc" } });
      expect(registros.map((linha) => linha.action)).toEqual(["SUBMITTED_FOR_REVIEW", "APPROVED"]);
      expect(registros.every((linha) => linha.userId === userId)).toBe(true);
    });

    it("sem imagem não fica pronta", async () => {
      const { token } = await entrar();
      const accountId = await conta();
      const postId = await criar(token, accountId, "Só texto");

      const resposta = await api.request({
        method: "POST",
        url: `/accounts/${accountId}/posts/${postId}/ready`,
        payload: { version: 1 },
        token,
      });

      expect(resposta.statusCode).toBe(422);
      expect(resposta.body).toMatchObject({ code: "POST_MEDIA_REQUIRED" });
    });

    it("legenda acima de 2200 caracteres salva como rascunho, mas não fica pronta", async () => {
      const { token } = await entrar();
      const accountId = await conta();
      const postId = await criar(token, accountId);

      // Salvar a legenda longa é permitido: o RF-C03 barra o agendamento, não o
      // rascunho. Perder o texto ao salvar seria pior que qualquer limite.
      const salvou = await api.request({
        method: "POST",
        url: `/accounts/${accountId}/posts/${postId}/caption`,
        payload: { version: 1, caption: "a".repeat(2201) },
        token,
      });
      expect(salvou.statusCode).toBe(200);

      await api.request({
        method: "POST",
        url: `/accounts/${accountId}/posts/${postId}/media`,
        payload: { version: 2, mediaId: await midia({ width: 1080, height: 1350 }) },
        token,
      });
      const pronta = await api.request({
        method: "POST",
        url: `/accounts/${accountId}/posts/${postId}/ready`,
        payload: { version: 3 },
        token,
      });

      expect(pronta.statusCode).toBe(422);
      expect(pronta.body).toMatchObject({ code: "POST_CAPTION_TOO_LONG" });
    });
  });

  /*
   * O elo com a parte anterior: o acervo aceita 9:16 porque serve a Stories, e
   * é aqui que o formato de destino decide (RF-B03).
   */
  describe("a imagem precisa servir ao formato", () => {
    it("uma imagem 9:16 é recusada numa postagem de feed", async () => {
      const { token } = await entrar();
      const accountId = await conta();
      const postId = await criar(token, accountId);

      const resposta = await api.request({
        method: "POST",
        url: `/accounts/${accountId}/posts/${postId}/media`,
        payload: { version: 1, mediaId: await midia({ width: 1080, height: 1920 }) },
        token,
      });

      expect(resposta.statusCode).toBe(422);
      expect(resposta.body).toMatchObject({ code: "MEDIA_RATIO_UNSUPPORTED" });
    });

    it("1080×1350 é exatamente 4:5 e passa", async () => {
      const { token } = await entrar();
      const accountId = await conta();
      const postId = await criar(token, accountId);

      const resposta = await api.request({
        method: "POST",
        url: `/accounts/${accountId}/posts/${postId}/media`,
        payload: { version: 1, mediaId: await midia({ width: 1080, height: 1350 }) },
        token,
      });

      expect(resposta.statusCode).toBe(200);
    });
  });

  /*
   * RF-E02 e RF-I04: aprovar a própria postagem exige a permissão extra. O
   * decorator não dá conta — ele roda antes de a postagem ser carregada.
   */
  describe("autoaprovação", () => {
    it("quem criou e não tem POSTAGEM_APROVAR_PROPRIA é recusado", async () => {
      const { token } = await entrar(["POST_EDIT", "POST_APPROVE"]);
      const accountId = await conta();
      const postId = await criar(token, accountId);

      await api.request({
        method: "POST",
        url: `/accounts/${accountId}/posts/${postId}/media`,
        payload: { version: 1, mediaId: await midia({ width: 1080, height: 1350 }) },
        token,
      });
      const resposta = await api.request({
        method: "POST",
        url: `/accounts/${accountId}/posts/${postId}/ready`,
        payload: { version: 2 },
        token,
      });

      expect(resposta.statusCode).toBe(403);
      expect(resposta.body).toMatchObject({ code: "SELF_APPROVAL_FORBIDDEN" });
    });

    it("sem POSTAGEM_APROVAR nenhuma, a rota nem é alcançada", async () => {
      const { token } = await entrar(["POST_EDIT"]);
      const accountId = await conta();
      const postId = await criar(token, accountId);

      const resposta = await api.request({
        method: "POST",
        url: `/accounts/${accountId}/posts/${postId}/ready`,
        payload: { version: 1 },
        token,
      });

      expect(resposta.statusCode).toBe(403);
      expect(resposta.body).toMatchObject({ code: "FORBIDDEN" });
    });
  });

  describe("descartar", () => {
    it("um rascunho vira CANCELADO", async () => {
      const { token } = await entrar();
      const accountId = await conta();
      const postId = await criar(token, accountId);

      const resposta = await api.request({
        method: "POST",
        url: `/accounts/${accountId}/posts/${postId}/discard`,
        payload: { version: 1 },
        token,
      });

      expect(resposta.statusCode).toBe(200);
      expect((await api.db.post.findUniqueOrThrow({ where: { id: postId } })).status).toBe("CANCELED");
    });

    it("uma postagem já descartada não aceita mais nada", async () => {
      const { token } = await entrar();
      const accountId = await conta();
      const postId = await criar(token, accountId);

      await api.request({
        method: "POST",
        url: `/accounts/${accountId}/posts/${postId}/discard`,
        payload: { version: 1 },
        token,
      });
      const resposta = await api.request({
        method: "POST",
        url: `/accounts/${accountId}/posts/${postId}/caption`,
        payload: { version: 2, caption: "tarde demais" },
        token,
      });

      expect(resposta.statusCode).toBe(409);
      expect(resposta.body).toMatchObject({ code: "POST_NOT_EDITABLE" });
    });
  });
});
