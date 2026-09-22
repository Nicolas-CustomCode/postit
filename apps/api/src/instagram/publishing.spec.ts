import type { FastifyInstance } from "fastify";
import { InstagramUnavailableError } from "../common/errors";
import {
  createFakeMeta,
  FAKE_META_ACCOUNT,
  FAKE_META_LONG_TOKEN,
  fakePublishing,
  type FakePublishingControl,
} from "../fake-meta/fake-meta";
import { InstagramClient, MetaRefusedError } from "./client";
import type { InstagramConfig } from "./instagram.config";
import { InstagramPublishingApi } from "./publishing";

/**
 * As chamadas de publicação contra a Meta falsa, por uma conexão de verdade — o
 * `inject` do Fastify não sabe derrubar uma conexão no meio, e é justamente esse
 * o caso que mais importa (docs/09, "O caso difícil").
 */
describe("InstagramPublishingApi — contra a Meta falsa", () => {
  const token = FAKE_META_LONG_TOKEN;
  const igUser = FAKE_META_ACCOUNT.user_id;
  const image = "https://midia.exemplo.com/publicas/postagens/a.jpg";

  let meta: FastifyInstance;
  let fake: FakePublishingControl;
  let api: InstagramPublishingApi;
  const requests: { url: string; authorization: string | undefined }[] = [];

  beforeAll(async () => {
    meta = createFakeMeta("test");
    meta.addHook("onRequest", async (request) => {
      requests.push({ url: request.url, authorization: request.headers.authorization });
    });
    await meta.listen({ port: 0, host: "127.0.0.1" });
    const address = meta.server.address();
    const port = typeof address === "object" && address ? address.port : 0;

    const config = { graphUrl: `http://127.0.0.1:${port}`, apiVersion: "v26.0" } as InstagramConfig;
    api = new InstagramPublishingApi(new InstagramClient(config));
    fake = fakePublishing(meta);
  });

  beforeEach(() => {
    fake.reset();
    requests.length = 0;
  });

  afterAll(async () => {
    await meta?.close();
  });

  describe("a matriz de parâmetros do docs/08", () => {
    it("imagem de feed leva legenda e texto alternativo, sem media_type", async () => {
      const id = await api.createImageContainer(igUser, token, {
        imageUrl: image,
        kind: "FEED",
        caption: "Legenda",
        altText: "Descrição",
      });

      expect(id).toBe(fake.createdContainers[0]!.id);
      expect(fake.createdContainers[0]!.body).toEqual({ image_url: image, caption: "Legenda", alt_text: "Descrição" });
    });

    it("item de carrossel leva is_carousel_item e texto alternativo, nunca legenda", async () => {
      await api.createImageContainer(igUser, token, {
        imageUrl: image,
        kind: "CAROUSEL_ITEM",
        caption: "não vai",
        altText: "Descrição",
      });

      expect(fake.createdContainers[0]!.body).toEqual({ image_url: image, is_carousel_item: true, alt_text: "Descrição" });
    });

    it("Story leva media_type STORIES, sem legenda nem texto alternativo", async () => {
      await api.createImageContainer(igUser, token, {
        imageUrl: image,
        kind: "STORY",
        caption: "não vai",
        altText: "não vai",
      });

      expect(fake.createdContainers[0]!.body).toEqual({ image_url: image, media_type: "STORIES" });
    });

    it("o carrossel pai leva os filhos separados por vírgula e a legenda", async () => {
      const a = await api.createImageContainer(igUser, token, { imageUrl: image, kind: "CAROUSEL_ITEM" });
      const b = await api.createImageContainer(igUser, token, { imageUrl: image, kind: "CAROUSEL_ITEM" });

      await api.createCarouselContainer(igUser, token, { children: [a, b], caption: "Legenda" });

      expect(fake.createdContainers[2]!.body).toEqual({ media_type: "CAROUSEL", children: `${a},${b}`, caption: "Legenda" });
    });

    it("legenda vazia não é enviada", async () => {
      await api.createImageContainer(igUser, token, { imageUrl: image, kind: "FEED", caption: "" });
      expect(fake.createdContainers[0]!.body).toEqual({ image_url: image });
    });
  });

  // Nas escritas, o token vai no cabeçalho: nenhum endereço registrado o carrega.
  it("as escritas levam o token no cabeçalho, nunca no endereço", async () => {
    const id = await api.createImageContainer(igUser, token, { imageUrl: image, kind: "FEED" });
    await api.publish(igUser, token, id);

    const writes = requests.filter((request) => !request.url.includes("fields="));
    expect(writes).toHaveLength(2);
    for (const write of writes) {
      expect(write.url).not.toContain(token);
      expect(write.authorization).toBe(`Bearer ${token}`);
    }
  });

  describe("estado do container", () => {
    it("segue o roteiro de estados, um por consulta", async () => {
      fake.nextContainerStatuses(["IN_PROGRESS", "IN_PROGRESS", "FINISHED"]);
      const id = await api.createImageContainer(igUser, token, { imageUrl: image, kind: "FEED" });

      const lidos = [];
      for (let i = 0; i < 4; i += 1) lidos.push((await api.containerStatus(id, token)).statusCode);

      expect(lidos).toEqual(["IN_PROGRESS", "IN_PROGRESS", "FINISHED", "FINISHED"]);
    });

    it("vira PUBLISHED depois de publicado", async () => {
      const id = await api.createImageContainer(igUser, token, { imageUrl: image, kind: "FEED" });
      await api.publish(igUser, token, id);

      expect((await api.containerStatus(id, token)).statusCode).toBe("PUBLISHED");
    });
  });

  describe("publicar", () => {
    it("devolve o id da mídia, e o permalink sai dele", async () => {
      const container = await api.createImageContainer(igUser, token, { imageUrl: image, kind: "FEED" });
      const media = await api.publish(igUser, token, container);

      expect(fake.publishedMedia).toEqual([{ id: media, containerId: container }]);
      expect(await api.permalink(media, token)).toMatch(/^https:\/\/www\.instagram\.com\/p\//);
    });

    it("antes de FINISHED é recusado com 9007/2207027", async () => {
      fake.nextContainerStatuses(["IN_PROGRESS"]);
      const container = await api.createImageContainer(igUser, token, { imageUrl: image, kind: "FEED" });

      await expect(api.publish(igUser, token, container)).rejects.toMatchObject({
        meta: { code: 9007, subcode: 2207027 },
      });
    });

    /*
     * O caso difícil: a Meta publicou, mas a resposta não chegou. Do lado de cá é
     * indistinguível de uma queda antes de publicar — os dois viram o mesmo erro de
     * indisponibilidade, e só a reconciliação separa um do outro.
     */
    it.each([
      ["drop-after-publish", 1],
      ["drop-before-publish", 0],
    ] as const)("com a conexão caindo (%s), o erro é o mesmo, e só a Meta sabe", async (outcome, published) => {
      const container = await api.createImageContainer(igUser, token, { imageUrl: image, kind: "FEED" });
      fake.nextPublish(outcome);

      await expect(api.publish(igUser, token, container)).rejects.toBeInstanceOf(InstagramUnavailableError);
      expect(fake.publishedMedia).toHaveLength(published);
    });
  });

  describe("recusas", () => {
    it("guardam código e subcódigo", async () => {
      fake.refuseNextCreate({ code: 9004, subcode: 2207052 });

      await expect(api.createImageContainer(igUser, token, { imageUrl: image, kind: "FEED" })).rejects.toMatchObject({
        meta: { status: 400, code: 9004, subcode: 2207052 },
      });
    });

    it("Meta instável chega como 5xx", async () => {
      fake.refuseNextCreate({ code: 2, httpStatus: 503 });

      await expect(api.createImageContainer(igUser, token, { imageUrl: image, kind: "FEED" })).rejects.toMatchObject({
        meta: { status: 503 },
      });
    });

    // RF-F09 pede o erro cru na auditoria — e a regra 3, que ele venha sem o token.
    it("trazem o corpo da Meta para a auditoria, sem o token", async () => {
      fake.refuseNextCreate({
        code: 190,
        message: `Invalid token ${token} (access_token=${token}&x=1)`,
      });

      const error = await api
        .createImageContainer(igUser, token, { imageUrl: image, kind: "FEED" })
        .catch((caught: unknown) => caught);

      expect(error).toBeInstanceOf(MetaRefusedError);
      const detail = (error as MetaRefusedError).detail;
      expect(detail).toMatchObject({ code: 190, type: "OAuthException", fbtrace_id: "fake-meta" });
      expect(JSON.stringify(detail)).not.toContain(token);
      expect(detail!.message).toBe("Invalid token *** (access_token=***&x=1)");
    });
  });
});
