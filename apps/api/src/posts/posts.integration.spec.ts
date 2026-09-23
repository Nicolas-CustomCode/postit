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
    permissions: readonly ("POST_EDIT" | "POST_APPROVE" | "POST_APPROVE_OWN" | "POST_SCHEDULE")[] = [
      "POST_EDIT",
      "POST_APPROVE",
      "POST_APPROVE_OWN",
      "POST_SCHEDULE",
    ],
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
      payload: { format: "FEED", ...(caption === undefined ? {} : { caption }) },
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
        format: "FEED",
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
        payload: { version: 1, media: [{ mediaId: await midia({ width: 1080, height: 1080 }) }] },
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
      { method: "POST" as const, caminho: (p: string) => `/${p}/media`, payload: { version: 1, media: [] } },
      { method: "POST" as const, caminho: (p: string) => `/${p}/format`, payload: { version: 1, format: "STORIES" } },
      { method: "POST" as const, caminho: (p: string) => `/${p}/ready`, payload: { version: 1 } },
      {
        method: "POST" as const,
        caminho: (p: string) => `/${p}/schedule`,
        payload: { version: 1, day: "2030-01-01", time: "10:00" },
      },
      { method: "POST" as const, caminho: (p: string) => `/${p}/cancel`, payload: { version: 1 } },
      { method: "POST" as const, caminho: (p: string) => `/${p}/discard`, payload: { version: 1 } },
      { method: "POST" as const, caminho: (p: string) => `/${p}/to-draft`, payload: { version: 1 } },
      { method: "GET" as const, caminho: (p: string) => `/${p}/history`, payload: undefined },
    ];

    it.each(ROTAS)("$method $caminho responde 404 pela conta errada", async (rota) => {
      const { token } = await entrar();
      const contaA = await conta("conta.a");
      const contaB = await conta("conta.b");
      const postId = await criar(token, contaA);

      // A rota de mídia precisa de uma mídia que exista, senão o 404 viria do
      // arquivo e não da conta — e o teste passaria pelo motivo errado.
      const payload =
        rota.payload !== undefined && "media" in rota.payload
          ? { ...rota.payload, media: [{ mediaId: await midia({ width: 1080, height: 1080 }) }] }
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
        payload: { version: 1, media: [{ mediaId: await midia({ width: 1080, height: 1350 }) }] },
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
        payload: { version: 3, media: [{ mediaId: await midia({ width: 1080, height: 1080 }) }] },
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
        payload: { version: 1, media: [{ mediaId: await midia({ width: 1080, height: 1350 }) }] },
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
        payload: { version: 2, media: [{ mediaId: await midia({ width: 1080, height: 1350 }) }] },
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
        payload: { version: 1, media: [{ mediaId: await midia({ width: 1080, height: 1920 }) }] },
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
        payload: { version: 1, media: [{ mediaId: await midia({ width: 1080, height: 1350 }) }] },
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
        payload: { version: 1, media: [{ mediaId: await midia({ width: 1080, height: 1350 }) }] },
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

  /*
   * O formato de destino (RF-C02, RF-B03). O acervo aceita uma imagem 9:16
   * porque ela serve a Stories; é aqui que o formato escolhido decide.
   */
  describe("formato", () => {
    it("uma imagem 9:16 entra num Stories e é recusada num feed", async () => {
      const { token } = await entrar();
      const accountId = await conta();
      const vertical = await midia({ width: 1080, height: 1920 });

      const feed = await criar(token, accountId);
      const recusada = await api.request({
        method: "POST",
        url: `/accounts/${accountId}/posts/${feed}/media`,
        payload: { version: 1, media: [{ mediaId: vertical }] },
        token,
      });
      expect(recusada.statusCode).toBe(422);
      expect(recusada.body).toMatchObject({ code: "MEDIA_RATIO_UNSUPPORTED" });

      const stories = (
        await api.request({
          method: "POST",
          url: `/accounts/${accountId}/posts`,
          payload: { format: "STORIES" },
          token,
        })
      ).body["id"] as string;
      const aceita = await api.request({
        method: "POST",
        url: `/accounts/${accountId}/posts/${stories}/media`,
        payload: { version: 1, media: [{ mediaId: vertical }] },
        token,
      });
      expect(aceita.statusCode).toBe(200);
    });

    /*
     * A rota de estrago que a troca de formato fecha: anexar 9:16 num Stories,
     * onde ela vale, e depois mudar para feed, onde não vale.
     */
    it("trocar de Stories para feed com uma imagem 9:16 é recusado", async () => {
      const { token } = await entrar();
      const accountId = await conta();

      const postId = (
        await api.request({
          method: "POST",
          url: `/accounts/${accountId}/posts`,
          payload: { format: "STORIES" },
          token,
        })
      ).body["id"] as string;
      await api.request({
        method: "POST",
        url: `/accounts/${accountId}/posts/${postId}/media`,
        payload: { version: 1, media: [{ mediaId: await midia({ width: 1080, height: 1920 }) }] },
        token,
      });

      const resposta = await api.request({
        method: "POST",
        url: `/accounts/${accountId}/posts/${postId}/format`,
        payload: { version: 2, format: "FEED" },
        token,
      });

      expect(resposta.statusCode).toBe(422);
      expect(resposta.body).toMatchObject({ code: "MEDIA_RATIO_UNSUPPORTED" });
      // E o formato não mudou: a recusa não deixa meio caminho andado.
      expect((await api.db.post.findUniqueOrThrow({ where: { id: postId } })).format).toBe("STORIES");
    });

    it("sem imagem ainda, trocar o formato é livre", async () => {
      const { token } = await entrar();
      const accountId = await conta();
      const postId = await criar(token, accountId, "Só texto");

      const resposta = await api.request({
        method: "POST",
        url: `/accounts/${accountId}/posts/${postId}/format`,
        payload: { version: 1, format: "STORIES" },
        token,
      });

      expect(resposta.statusCode).toBe(200);
      expect((await api.db.post.findUniqueOrThrow({ where: { id: postId } })).format).toBe("STORIES");
    });

    /*
     * Formato é conteúdo (RF-E05 o cita com todas as letras): trocar derruba a
     * postagem para rascunho e o horário sai junto, como legenda e mídia.
     */
    it("trocar o formato de uma postagem agendada a derruba e apaga o horário", async () => {
      const { token } = await entrar();
      const accountId = await conta();
      const postId = await criar(token, accountId, "Pronta");

      await api.request({
        method: "POST",
        url: `/accounts/${accountId}/posts/${postId}/media`,
        payload: { version: 1, media: [{ mediaId: await midia({ width: 1080, height: 1080 }) }] },
        token,
      });
      await api.request({
        method: "POST",
        url: `/accounts/${accountId}/posts/${postId}/ready`,
        payload: { version: 2 },
        token,
      });
      await api.request({
        method: "POST",
        url: `/accounts/${accountId}/posts/${postId}/schedule`,
        payload: { version: 3, day: "2030-10-15", time: "10:00" },
        token,
      });

      const resposta = await api.request({
        method: "POST",
        url: `/accounts/${accountId}/posts/${postId}/format`,
        payload: { version: 4, format: "STORIES" },
        token,
      });

      expect(resposta.statusCode).toBe(200);
      const gravada = await api.db.post.findUniqueOrThrow({ where: { id: postId } });
      expect(gravada.status).toBe("DRAFT");
      expect(gravada.scheduledAt).toBeNull();
    });

    it("trocar de Feed com três imagens para Stories é recusado", async () => {
      const { token } = await entrar();
      const accountId = await conta();
      const postId = await criar(token, accountId);
      const tres = await Promise.all([0, 1, 2].map(() => midia({ width: 1080, height: 1080 })));

      await api.request({
        method: "POST",
        url: `/accounts/${accountId}/posts/${postId}/media`,
        payload: { version: 1, media: tres.map((mediaId) => ({ mediaId })) },
        token,
      });

      const resposta = await api.request({
        method: "POST",
        url: `/accounts/${accountId}/posts/${postId}/format`,
        payload: { version: 2, format: "STORIES" },
        token,
      });

      expect(resposta.statusCode).toBe(422);
      expect(resposta.body).toMatchObject({ code: "POST_FORMAT_SINGLE_MEDIA" });
      const gravada = await api.db.post.findUniqueOrThrow({ where: { id: postId } });
      expect(gravada.format).toBe("FEED");
    });
  });

  /*
   * Carrossel (RF-C04; ADR 0024).
   *
   * Carrossel não é formato, é quantidade: a mesma rota de mídia recebe a lista
   * inteira, e a ordem do array vira a coluna `ordem`. **A ordem é conteúdo** —
   * a primeira imagem define o recorte de todas na Meta (docs/08).
   */
  describe("carrossel", () => {
    /** As mídias da postagem, na ordem gravada. */
    async function midiasDe(postId: string): Promise<{ mediaId: string; position: number }[]> {
      const linhas = await api.db.postMedia.findMany({
        where: { postId },
        orderBy: { position: "asc" },
        select: { mediaId: true, position: true },
      });
      return linhas;
    }

    async function comTres(token: string, accountId: string): Promise<{ postId: string; ids: string[] }> {
      const postId = await criar(token, accountId);
      const ids = await Promise.all([0, 1, 2].map(() => midia({ width: 1080, height: 1080 })));

      const resposta = await api.request({
        method: "POST",
        url: `/accounts/${accountId}/posts/${postId}/media`,
        payload: { version: 1, media: ids.map((mediaId) => ({ mediaId })) },
        token,
      });

      expect(resposta.statusCode).toBe(200);
      return { postId, ids };
    }

    it("três imagens ficam gravadas nas posições 0, 1 e 2", async () => {
      const { token } = await entrar();
      const accountId = await conta();
      const { postId, ids } = await comTres(token, accountId);

      expect(await midiasDe(postId)).toEqual([
        { mediaId: ids[0], position: 0 },
        { mediaId: ids[1], position: 1 },
        { mediaId: ids[2], position: 2 },
      ]);
    });

    /*
     * O caso que o `deleteMany` antes do `createMany` existe para resolver: a
     * unicidade de (postagemId, ordem) é conferida na hora, então trocar a
     * ordem sem apagar antes estouraria.
     */
    it("reordenar troca as posições e não cria linha nova", async () => {
      const { token } = await entrar();
      const accountId = await conta();
      const { postId, ids } = await comTres(token, accountId);

      const resposta = await api.request({
        method: "POST",
        url: `/accounts/${accountId}/posts/${postId}/media`,
        payload: { version: 2, media: [...ids].reverse().map((mediaId) => ({ mediaId })) },
        token,
      });

      expect(resposta.statusCode).toBe(200);
      expect(await midiasDe(postId)).toEqual([
        { mediaId: ids[2], position: 0 },
        { mediaId: ids[1], position: 1 },
        { mediaId: ids[0], position: 2 },
      ]);
    });

    it("remover volta a lista para uma imagem", async () => {
      const { token } = await entrar();
      const accountId = await conta();
      const { postId, ids } = await comTres(token, accountId);

      await api.request({
        method: "POST",
        url: `/accounts/${accountId}/posts/${postId}/media`,
        payload: { version: 2, media: [{ mediaId: ids[1] }] },
        token,
      });

      expect(await midiasDe(postId)).toEqual([{ mediaId: ids[1], position: 0 }]);
    });

    /*
     * Lista vazia é "tirei todas", não erro: o mesmo raciocínio de `caption:
     * null`. Quem impede a postagem de ficar **pronta** é o portão de prontidão.
     */
    it("lista vazia limpa a mídia, e aí a postagem não fica pronta", async () => {
      const { token } = await entrar();
      const accountId = await conta();
      const { postId } = await comTres(token, accountId);

      const limpar = await api.request({
        method: "POST",
        url: `/accounts/${accountId}/posts/${postId}/media`,
        payload: { version: 2, media: [] },
        token,
      });

      expect(limpar.statusCode).toBe(200);
      expect(await midiasDe(postId)).toEqual([]);

      const pronta = await api.request({
        method: "POST",
        url: `/accounts/${accountId}/posts/${postId}/ready`,
        payload: { version: 3 },
        token,
      });

      expect(pronta.statusCode).toBe(422);
      expect(pronta.body).toMatchObject({ code: "POST_MEDIA_REQUIRED" });
    });

    /*
     * Nada na documentação da Meta proíbe repetir a imagem, e a unicidade do
     * banco é de posição, não de mídia. Recusar seria inventar regra sem fonte.
     */
    it("a mesma imagem duas vezes é aceita", async () => {
      const { token } = await entrar();
      const accountId = await conta();
      const postId = await criar(token, accountId);
      const mediaId = await midia({ width: 1080, height: 1080 });

      const resposta = await api.request({
        method: "POST",
        url: `/accounts/${accountId}/posts/${postId}/media`,
        payload: { version: 1, media: [{ mediaId }, { mediaId }] },
        token,
      });

      expect(resposta.statusCode).toBe(200);
      expect(await midiasDe(postId)).toEqual([
        { mediaId, position: 0 },
        { mediaId, position: 1 },
      ]);
    });

    it("onze imagens são recusadas pelo schema de entrada", async () => {
      const { token } = await entrar();
      const accountId = await conta();
      const postId = await criar(token, accountId);
      const mediaId = await midia({ width: 1080, height: 1080 });

      const resposta = await api.request({
        method: "POST",
        url: `/accounts/${accountId}/posts/${postId}/media`,
        payload: { version: 1, media: Array.from({ length: 11 }, () => ({ mediaId })) },
        token,
      });

      expect(resposta.statusCode).toBe(400);
      expect(resposta.body).toMatchObject({ code: "VALIDATION_FAILED" });
    });

    it("uma imagem 9:16 no meio de um carrossel de feed é recusada", async () => {
      const { token } = await entrar();
      const accountId = await conta();
      const postId = await criar(token, accountId);
      const boa = await midia({ width: 1080, height: 1080 });
      const vertical = await midia({ width: 1080, height: 1920 });

      const resposta = await api.request({
        method: "POST",
        url: `/accounts/${accountId}/posts/${postId}/media`,
        payload: { version: 1, media: [{ mediaId: boa }, { mediaId: vertical }, { mediaId: boa }] },
        token,
      });

      expect(resposta.statusCode).toBe(422);
      expect(resposta.body).toMatchObject({ code: "MEDIA_RATIO_UNSUPPORTED" });
      expect(await midiasDe(postId)).toEqual([]);
    });

    it("mídia inexistente no meio da lista recusa a lista inteira", async () => {
      const { token } = await entrar();
      const accountId = await conta();
      const { postId, ids } = await comTres(token, accountId);

      const resposta = await api.request({
        method: "POST",
        url: `/accounts/${accountId}/posts/${postId}/media`,
        payload: {
          version: 2,
          media: [{ mediaId: ids[0] }, { mediaId: "00000000-0000-4000-8000-000000000000" }],
        },
        token,
      });

      expect(resposta.statusCode).toBe(400);
      expect(resposta.body).toMatchObject({ code: "MEDIA_UPLOAD_INVALID" });
      // A lista anterior continua inteira: a recusa acontece antes da transação.
      expect(await midiasDe(postId)).toHaveLength(3);
    });

    /*
     * A invariante I-2 aplicada à ordem: alguém aprovou uma sequência, e
     * publicar outra seria publicar coisa que ninguém aprovou (docs/07).
     */
    it("reordenar uma postagem aprovada a derruba para rascunho", async () => {
      const { token } = await entrar();
      const accountId = await conta();
      const { postId, ids } = await comTres(token, accountId);

      const pronta = await api.request({
        method: "POST",
        url: `/accounts/${accountId}/posts/${postId}/ready`,
        payload: { version: 2 },
        token,
      });
      expect(pronta.statusCode).toBe(200);

      await api.request({
        method: "POST",
        url: `/accounts/${accountId}/posts/${postId}/media`,
        payload: { version: 3, media: [...ids].reverse().map((mediaId) => ({ mediaId })) },
        token,
      });

      const gravada = await api.db.post.findUniqueOrThrow({ where: { id: postId } });
      expect(gravada.status).toBe("DRAFT");
    });
  });

  /*
   * Agendar (RF-D01, RF-D03, RF-D04, RF-D05; ADR 0006).
   *
   * A aritmética de fuso tem spec próprio em `domain/time/zone.spec.ts`. Aqui se
   * prova que o instante chega ao banco em UTC e que os estados se comportam.
   */
  describe("agendar", () => {
    /** Uma postagem pronta para agendar: com imagem e já aprovada. */
    async function postagemPronta(token: string, accountId: string): Promise<{ id: string; version: number }> {
      const postId = await criar(token, accountId, "Pronta para sair");

      await api.request({
        method: "POST",
        url: `/accounts/${accountId}/posts/${postId}/media`,
        payload: { version: 1, media: [{ mediaId: await midia({ width: 1080, height: 1350 }) }] },
        token,
      });
      await api.request({
        method: "POST",
        url: `/accounts/${accountId}/posts/${postId}/ready`,
        payload: { version: 2 },
        token,
      });

      return { id: postId, version: 3 };
    }

    it("o relógio da conta vira instante em UTC no banco", async () => {
      const { token } = await entrar();
      const accountId = await conta();
      const post = await postagemPronta(token, accountId);

      const resposta = await api.request({
        method: "POST",
        url: `/accounts/${accountId}/posts/${post.id}/schedule`,
        payload: { version: post.version, day: "2030-10-15", time: "10:00" },
        token,
      });

      expect(resposta.statusCode).toBe(200);

      const gravada = await api.db.post.findUniqueOrThrow({ where: { id: post.id } });
      expect(gravada.status).toBe("SCHEDULED");
      // 10:00 em São Paulo é 13:00 UTC — a conta de teste nasce nesse fuso.
      expect(gravada.scheduledAt?.toISOString()).toBe("2030-10-15T13:00:00.000Z");
      // E fica registrado quem mandou sair nesse horário.
      expect(gravada.scheduledById).not.toBeNull();
    });

    /*
     * Reagendar troca o campo e **não** mexe no status: não é transição
     * (RF-D04; AGENTS.md, regra 8).
     */
    it("reagendar mantém AGENDADO e troca o instante", async () => {
      const { token } = await entrar();
      const accountId = await conta();
      const post = await postagemPronta(token, accountId);

      await api.request({
        method: "POST",
        url: `/accounts/${accountId}/posts/${post.id}/schedule`,
        payload: { version: post.version, day: "2030-10-15", time: "10:00" },
        token,
      });
      const resposta = await api.request({
        method: "POST",
        url: `/accounts/${accountId}/posts/${post.id}/schedule`,
        payload: { version: post.version + 1, day: "2030-10-16", time: "18:30" },
        token,
      });

      expect(resposta.statusCode).toBe(200);

      const gravada = await api.db.post.findUniqueOrThrow({ where: { id: post.id } });
      expect(gravada.status).toBe("SCHEDULED");
      expect(gravada.scheduledAt?.toISOString()).toBe("2030-10-16T21:30:00.000Z");
    });

    it("agendar um rascunho é recusado — só APROVADO chega a AGENDADO (I-1)", async () => {
      const { token } = await entrar();
      const accountId = await conta();
      const postId = await criar(token, accountId, "Ainda rascunho");

      const resposta = await api.request({
        method: "POST",
        url: `/accounts/${accountId}/posts/${postId}/schedule`,
        payload: { version: 1, day: "2030-10-15", time: "10:00" },
        token,
      });

      expect(resposta.statusCode).toBe(409);
      expect(resposta.body).toMatchObject({ code: "POST_TRANSITION_INVALID" });
    });

    it("horário no passado é recusado, com o motivo", async () => {
      const { token } = await entrar();
      const accountId = await conta();
      const post = await postagemPronta(token, accountId);

      const resposta = await api.request({
        method: "POST",
        url: `/accounts/${accountId}/posts/${post.id}/schedule`,
        payload: { version: post.version, day: "2020-01-01", time: "10:00" },
        token,
      });

      expect(resposta.statusCode).toBe(422);
      expect(resposta.body).toMatchObject({ code: "SCHEDULE_IN_PAST" });
    });

    /*
     * O elo com a invariante I-2: editar conteúdo derruba para rascunho, e o
     * horário precisa sair junto — senão a tela mostraria horário de saída numa
     * postagem que não vai sair. O que a pessoa digitou fica na tela, não no
     * banco (decidido em 20/09/2026).
     */
    it("editar a legenda de uma agendada derruba para rascunho e apaga o horário", async () => {
      const { token } = await entrar();
      const accountId = await conta();
      const post = await postagemPronta(token, accountId);

      await api.request({
        method: "POST",
        url: `/accounts/${accountId}/posts/${post.id}/schedule`,
        payload: { version: post.version, day: "2030-10-15", time: "10:00" },
        token,
      });
      const resposta = await api.request({
        method: "POST",
        url: `/accounts/${accountId}/posts/${post.id}/caption`,
        payload: { version: post.version + 1, caption: "Mudei de ideia" },
        token,
      });

      expect(resposta.statusCode).toBe(200);

      const gravada = await api.db.post.findUniqueOrThrow({ where: { id: post.id } });
      expect(gravada.status).toBe("DRAFT");
      expect(gravada.scheduledAt).toBeNull();
    });

    describe("cancelar", () => {
      it("uma postagem agendada vira CANCELADO", async () => {
        const { token } = await entrar();
        const accountId = await conta();
        const post = await postagemPronta(token, accountId);

        await api.request({
          method: "POST",
          url: `/accounts/${accountId}/posts/${post.id}/schedule`,
          payload: { version: post.version, day: "2030-10-15", time: "10:00" },
          token,
        });
        const resposta = await api.request({
          method: "POST",
          url: `/accounts/${accountId}/posts/${post.id}/cancel`,
          payload: { version: post.version + 1 },
          token,
        });

        expect(resposta.statusCode).toBe(200);
        expect((await api.db.post.findUniqueOrThrow({ where: { id: post.id } })).status).toBe("CANCELED");
      });

      /*
       * FALHOU só existe depois do motor de publicação (1d), então a postagem
       * é posta nesse estado direto no banco. O domínio já precisa aceitar: é
       * o "humano cancela" da invariante I-4.
       */
      it("uma postagem que falhou também pode ser cancelada", async () => {
        const { token } = await entrar();
        const accountId = await conta();
        const post = await postagemPronta(token, accountId);

        await api.db.post.update({ where: { id: post.id }, data: { status: "FAILED" } });

        const resposta = await api.request({
          method: "POST",
          url: `/accounts/${accountId}/posts/${post.id}/cancel`,
          payload: { version: post.version },
          token,
        });

        expect(resposta.statusCode).toBe(200);
        expect((await api.db.post.findUniqueOrThrow({ where: { id: post.id } })).status).toBe("CANCELED");
      });

      /*
       * Rascunho não se cancela: descarta. São portas diferentes para a mesma
       * aresta, com permissões diferentes.
       */
      it("um rascunho não é cancelado por esta rota", async () => {
        const { token } = await entrar();
        const accountId = await conta();
        const postId = await criar(token, accountId);

        const resposta = await api.request({
          method: "POST",
          url: `/accounts/${accountId}/posts/${postId}/cancel`,
          payload: { version: 1 },
          token,
        });

        expect(resposta.statusCode).toBe(409);
        expect(resposta.body).toMatchObject({ code: "POST_TRANSITION_INVALID" });
      });
    });

    it("sem POSTAGEM_AGENDAR, as duas rotas são recusadas", async () => {
      const { token } = await entrar(["POST_EDIT"]);
      const accountId = await conta();
      const postId = await criar(token, accountId);

      for (const acao of ["schedule", "cancel"]) {
        const resposta = await api.request({
          method: "POST",
          url: `/accounts/${accountId}/posts/${postId}/${acao}`,
          payload: { version: 1, day: "2030-10-15", time: "10:00" },
          token,
        });

        expect(resposta.statusCode).toBe(403);
        expect(resposta.body).toMatchObject({ code: "FORBIDDEN" });
      }
    });

    /*
     * A postagem que falhou (RF-F07; ADR 0007): o que a tela precisa saber, e as
     * três saídas — reagendar, voltar para rascunho, cancelar. O estado é posto
     * direto no banco, como o motor o deixaria.
     */
    describe("a postagem que falhou", () => {
      async function falhada(token: string, accountId: string) {
        const post = await postagemPronta(token, accountId);
        await api.db.post.update({
          where: { id: post.id },
          data: {
            status: "FAILED",
            scheduledAt: new Date("2030-10-15T13:00:00.000Z"),
            attempts: 5,
            lastErrorCode: "RATE_LIMITED",
            lastErrorMessage: "meta 4/?",
          },
        });
        return post;
      }
      const url = (accountId: string, postId: string, acao = "") =>
        `/accounts/${accountId}/posts/${postId}${acao === "" ? "" : `/${acao}`}`;

      it("o detalhe e a lista trazem a causa e as tentativas — nunca o código cru", async () => {
        const { token } = await entrar();
        const accountId = await conta();
        const post = await falhada(token, accountId);

        const detalhe = await api.request({ method: "GET", url: url(accountId, post.id), token });
        expect(detalhe.body).toMatchObject({
          failureCause: "RATE_LIMITED",
          attempts: 5,
          publication: null,
          accountAccessLost: false,
        });
        expect(JSON.stringify(detalhe.body)).not.toContain("meta 4");

        const lista = await api.request({ method: "GET", url: `/accounts/${accountId}/posts`, token });
        expect((lista.body as unknown as { failureCause: string }[])[0]?.failureCause).toBe("RATE_LIMITED");
      });

      it("a publicada traz quando saiu e o link", async () => {
        const { token } = await entrar();
        const accountId = await conta();
        const post = await postagemPronta(token, accountId);
        await api.db.post.update({ where: { id: post.id }, data: { status: "PUBLISHED" } });
        await api.db.publication.create({
          data: {
            postId: post.id,
            externalId: "18000000001",
            permalink: "https://www.instagram.com/p/abc/",
            publishedAt: new Date("2030-10-15T13:01:00.000Z"),
          },
        });

        const detalhe = await api.request({ method: "GET", url: url(accountId, post.id), token });

        expect(detalhe.body).toMatchObject({
          publication: { publishedAt: "2030-10-15T13:01:00.000Z", permalink: "https://www.instagram.com/p/abc/" },
        });
      });

      it("a conta sem acesso aparece no detalhe", async () => {
        const { token } = await entrar();
        const accountId = await conta();
        const post = await falhada(token, accountId);
        await api.db.account.update({ where: { id: accountId }, data: { accessLostAt: new Date() } });

        const detalhe = await api.request({ method: "GET", url: url(accountId, post.id), token });

        expect(detalhe.body).toMatchObject({ accountAccessLost: true });
      });

      // Decisão 3 da 1d: a versão aprovada era a que falhou.
      it("editar a legenda derruba para rascunho, sem horário, e recomeça as tentativas", async () => {
        const { token } = await entrar();
        const accountId = await conta();
        const post = await falhada(token, accountId);

        const resposta = await api.request({
          method: "POST",
          url: url(accountId, post.id, "caption"),
          payload: { version: post.version, caption: "Corrigida" },
          token,
        });

        expect(resposta.statusCode).toBe(200);
        const gravada = await api.db.post.findUniqueOrThrow({ where: { id: post.id } });
        expect(gravada).toMatchObject({ status: "DRAFT", scheduledAt: null, attempts: 0, lastErrorCode: null });
      });

      it("reagendar volta a AGENDADO e recomeça as tentativas", async () => {
        const { token } = await entrar();
        const accountId = await conta();
        const post = await falhada(token, accountId);

        const resposta = await api.request({
          method: "POST",
          url: url(accountId, post.id, "schedule"),
          payload: { version: post.version, day: "2030-10-16", time: "10:00" },
          token,
        });

        expect(resposta.statusCode).toBe(200);
        const gravada = await api.db.post.findUniqueOrThrow({ where: { id: post.id } });
        expect(gravada).toMatchObject({ status: "SCHEDULED", attempts: 0, lastErrorCode: null, lastErrorMessage: null });
      });

      it("reagendar confere de novo se está pronta — sem imagem, recusa", async () => {
        const { token } = await entrar();
        const accountId = await conta();
        const post = await falhada(token, accountId);
        await api.db.postMedia.deleteMany({ where: { postId: post.id } });

        const resposta = await api.request({
          method: "POST",
          url: url(accountId, post.id, "schedule"),
          payload: { version: post.version, day: "2030-10-16", time: "10:00" },
          token,
        });

        expect(resposta.body).toMatchObject({ code: "POST_MEDIA_REQUIRED" });
        expect((await api.db.post.findUniqueOrThrow({ where: { id: post.id } })).status).toBe("FAILED");
      });

      it("voltar para rascunho: sem horário, tentativas zeradas", async () => {
        const { token } = await entrar();
        const accountId = await conta();
        const post = await falhada(token, accountId);

        const resposta = await api.request({
          method: "POST",
          url: url(accountId, post.id, "to-draft"),
          payload: { version: post.version },
          token,
        });

        expect(resposta.statusCode).toBe(200);
        expect(resposta.body).toMatchObject({ version: post.version + 1 });
        const gravada = await api.db.post.findUniqueOrThrow({ where: { id: post.id } });
        expect(gravada).toMatchObject({ status: "DRAFT", scheduledAt: null, attempts: 0, lastErrorCode: null });
      });

      it("voltar para rascunho só vale para a que falhou", async () => {
        const { token } = await entrar();
        const accountId = await conta();
        const post = await postagemPronta(token, accountId);

        const resposta = await api.request({
          method: "POST",
          url: url(accountId, post.id, "to-draft"),
          payload: { version: post.version },
          token,
        });

        expect(resposta.statusCode).toBe(409);
        expect(resposta.body).toMatchObject({ code: "POST_TRANSITION_INVALID" });
      });

      it("voltar para rascunho com a versão velha dá conflito", async () => {
        const { token } = await entrar();
        const accountId = await conta();
        const post = await falhada(token, accountId);

        const resposta = await api.request({
          method: "POST",
          url: url(accountId, post.id, "to-draft"),
          payload: { version: post.version - 1 },
          token,
        });

        expect(resposta.statusCode).toBe(409);
        expect(resposta.body).toMatchObject({ code: "POST_VERSION_CONFLICT" });
      });

      // Decidir sobre uma que falhou é de quem agenda (ADR 0015).
      it("voltar para rascunho sem POSTAGEM_AGENDAR é recusado", async () => {
        const dono = await entrar();
        const accountId = await conta();
        const post = await falhada(dono.token, accountId);
        const { token } = await entrar(["POST_EDIT"]);

        const resposta = await api.request({
          method: "POST",
          url: url(accountId, post.id, "to-draft"),
          payload: { version: post.version },
          token,
        });

        expect(resposta.statusCode).toBe(403);
      });

      it("o histórico lista o que o motor fez, em ordem", async () => {
        const { token } = await entrar(["POST_EDIT"]);
        const accountId = await conta();
        const dono = await entrar();
        const post = await falhada(dono.token, accountId);
        await api.db.publishEvent.create({ data: { postId: post.id, step: "DISPATCH", result: "SUCCESS" } });
        await api.db.publishEvent.create({
          data: { postId: post.id, step: "CREATE_CONTAINER", result: "FATAL_ERROR", metaResponse: { code: 190 } },
        });

        const resposta = await api.request({ method: "GET", url: url(accountId, post.id, "history"), token });

        expect(resposta.statusCode).toBe(200);
        expect(resposta.body).toMatchObject([
          { step: "DISPATCH", result: "SUCCESS" },
          { step: "CREATE_CONTAINER", result: "FATAL_ERROR", detail: { code: 190 } },
        ]);
      });

      // Regra 24: a postagem de outra conta não aparece por este endereço.
      it("o histórico de uma postagem de outra conta dá 404", async () => {
        const { token } = await entrar();
        const accountId = await conta();
        const outraConta = await conta("outra.conta");
        const post = await falhada(token, accountId);

        const resposta = await api.request({ method: "GET", url: url(outraConta, post.id, "history"), token });

        expect(resposta.statusCode).toBe(404);
      });
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
