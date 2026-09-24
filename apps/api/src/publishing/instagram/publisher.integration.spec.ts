import type { FastifyInstance } from "fastify";
import { createTestAccount, createTestPost, createTestUser } from "../../common/testing/factories";
import { bootTestWorker, type TestWorker } from "../../common/testing/test-worker";
import {
  createFakeMeta,
  FAKE_META_LONG_TOKEN,
  fakePublishing,
  type FakePublishingControl,
} from "../../fake-meta/fake-meta";
import { InstagramPublishingApi } from "../../instagram/publishing";
import { POST_METRICS_QUEUE } from "../../queues/queue-names";
import { PublishRetryError } from "./publisher.service";

const minutesAgo = (n: number) => new Date(Date.now() - n * 60_000);

/**
 * O publicador contra o Postgres de verdade e a Meta falsa (docs/15).
 *
 * O teste mais importante do projeto está aqui: **dois publicadores ao mesmo
 * tempo, uma publicação só** (roteiro de fogo, teste 6).
 */
describe("publicador", () => {
  let meta: FastifyInstance;
  let fake: FakePublishingControl;
  let worker: TestWorker;
  let api: InstagramPublishingApi;
  let accountId: string;
  let igUserId: string;
  let userId: string;

  beforeAll(async () => {
    meta = createFakeMeta("test");
    await meta.listen({ port: 0, host: "127.0.0.1" });
    const address = meta.server.address();
    const base = `http://127.0.0.1:${typeof address === "object" && address ? address.port : 0}`;

    worker = await bootTestWorker({ META_GRAPH_URL: base, META_AUTH_URL: base, META_TOKEN_URL: base });
    fake = fakePublishing(meta);
    api = worker.context.get(InstagramPublishingApi);
  });

  beforeEach(async () => {
    await worker.reset();
    fake.reset();
    userId = (await createTestUser(worker.db, worker.encryptionKey)).id;
    accountId = (await createTestAccount(worker.db, worker.encryptionKey, { token: FAKE_META_LONG_TOKEN })).id;
    igUserId = (await worker.db.account.findUniqueOrThrow({ where: { id: accountId } })).externalId;
  });

  afterAll(async () => {
    await worker?.close();
    await meta?.close();
  });

  const seed = (extra: Partial<Parameters<typeof createTestPost>[1]> = {}) =>
    createTestPost(worker.db, { accountId, createdById: userId, ...extra });
  const run = (post: { id: string; version: number }) =>
    worker.publisher.run({ postId: post.id, version: post.version }, new AbortController().signal);
  const saved = (id: string) => worker.db.post.findUniqueOrThrow({ where: { id }, include: { publication: true } });
  const steps = async (id: string) =>
    (await worker.db.publishEvent.findMany({ where: { postId: id }, orderBy: { createdAt: "asc" } })).map(
      (event) => `${event.step}:${event.result}`,
    );

  describe("caminho feliz", () => {
    it("imagem única: publica, grava o id e o permalink, e agenda as métricas", async () => {
      const post = await seed();

      await run(post);

      const result = await saved(post.id);
      expect(result.status).toBe("PUBLISHED");
      expect(result.publication?.externalId).toBe(fake.publishedMedia[0]!.id);
      expect(result.publication?.permalink).toMatch(/^https:\/\/www\.instagram\.com\/p\//);
      expect(result.attempts).toBe(1);
      // Regra 20: o worker não toca na versão.
      expect(result.version).toBe(post.version);
      expect(result.runId).toBeNull();

      expect(fake.createdContainers).toHaveLength(1);
      expect(fake.createdContainers[0]!.body).toMatchObject({ caption: "Legenda de teste", alt_text: "Descrição 0" });
      expect(String(fake.createdContainers[0]!.body["image_url"])).toContain(post.objectKeys[0]);

      expect(await steps(post.id)).toEqual(["CREATE_CONTAINER:SUCCESS", "PUBLISH:SUCCESS"]);
      const metrics = await worker.boss.findJobs<{ postId: string; moment: string }>(POST_METRICS_QUEUE);
      expect(metrics.map((job) => job.data.moment).sort()).toEqual(["T1H", "T24H", "T7D"]);
    });

    it("carrossel de 3: filhos na ordem, legenda só no pai", async () => {
      const post = await seed({ mediaCount: 3 });

      await run(post);

      expect((await saved(post.id)).status).toBe("PUBLISHED");
      const [a, b, c, parent] = fake.createdContainers;
      for (const [index, child] of [a, b, c].entries()) {
        expect(child!.body).toEqual({
          image_url: expect.stringContaining(post.objectKeys[index]!),
          is_carousel_item: true,
          alt_text: `Descrição ${index}`,
        });
      }
      expect(parent!.body).toEqual({
        media_type: "CAROUSEL",
        children: `${a!.id},${b!.id},${c!.id}`,
        caption: "Legenda de teste",
      });
      expect(fake.publishedMedia).toEqual([{ id: expect.any(String), containerId: parent!.id }]);
    });

    it("Story: sem legenda nem texto alternativo, e métricas até T+20h", async () => {
      const post = await seed({ format: "STORIES" });

      await run(post);

      expect(fake.createdContainers[0]!.body).toEqual({
        image_url: expect.any(String),
        media_type: "STORIES",
      });
      const metrics = await worker.boss.findJobs<{ moment: string }>(POST_METRICS_QUEUE);
      expect(metrics.map((job) => job.data.moment).sort()).toEqual(["STORY_20H", "T1H"]);
    });

    it("espera o container ficar pronto antes de publicar", async () => {
      fake.nextContainerStatuses(["IN_PROGRESS", "IN_PROGRESS", "FINISHED"]);
      const post = await seed();

      await run(post);

      expect((await saved(post.id)).status).toBe("PUBLISHED");
      expect(fake.publishCalls).toBe(1);
    });
  });

  describe("nunca duas vezes", () => {
    // Roteiro de fogo, teste 6 — o mais importante do projeto.
    it("dois publicadores em paralelo: um media_publish, uma Publicacao", async () => {
      fake.nextContainerStatuses(["IN_PROGRESS", "FINISHED"]);
      const post = await seed();

      await Promise.all([run(post), run(post), run(post)]);

      expect(fake.publishCalls).toBe(1);
      expect(fake.publishedMedia).toHaveLength(1);
      expect(fake.createdContainers).toHaveLength(1);
      expect(await worker.db.publication.count({ where: { postId: post.id } })).toBe(1);
    });

    it("com Publicacao já gravada, não fala com a Meta — e acerta o status", async () => {
      const post = await seed();
      await worker.db.publication.create({ data: { postId: post.id, externalId: "m1", publishedAt: new Date() } });

      await run(post);

      expect(fake.createdContainers).toHaveLength(0);
      expect((await saved(post.id)).status).toBe("PUBLISHED");
    });

    it("fora de PROCESSANDO, não faz nada", async () => {
      const post = await seed({ status: "FAILED" });
      await run(post);
      expect(fake.createdContainers).toHaveLength(0);
    });

    it("de outra versão (a pessoa mudou a postagem), não faz nada", async () => {
      const post = await seed();
      await run({ id: post.id, version: post.version + 1 });
      expect(fake.createdContainers).toHaveLength(0);
      expect((await saved(post.id)).status).toBe("PROCESSING");
    });

    it("com o arrendamento nas mãos de outra execução, sai quieto", async () => {
      const post = await seed();
      await worker.db.post.update({
        where: { id: post.id },
        data: { runId: "0190a000-0000-7000-8000-000000000001", runLeaseUntil: new Date(Date.now() + 60_000) },
      });

      await run(post);

      expect(fake.createdContainers).toHaveLength(0);
      expect((await saved(post.id)).attempts).toBe(0);
    });

    // Roteiro de fogo, teste 10: caiu depois de pedir a publicação, antes de gravar.
    it("queda depois do media_publish: a próxima execução confere e não publica de novo", async () => {
      const post = await seed({ attempts: 1 });
      const containerId = await api.createImageContainer(igUserId, FAKE_META_LONG_TOKEN, {
        imageUrl: "https://midia.exemplo.com/a.jpg",
        kind: "FEED",
      });
      await api.publish(igUserId, FAKE_META_LONG_TOKEN, containerId);
      await worker.db.publishContainer.create({
        data: {
          postId: post.id,
          igContainerId: containerId,
          role: "SINGLE",
          postVersion: post.version,
          statusCode: "FINISHED",
          publishRequestedAt: new Date(),
          expiresAt: new Date(Date.now() + 20 * 60 * 60_000),
        },
      });

      await run(post);

      const result = await saved(post.id);
      expect(result.status).toBe("PUBLISHED");
      // Confirmada pelo container, sem o id da mídia (V-28): publicada sem link.
      expect(result.publication?.externalId).toBeNull();
      expect(fake.publishCalls).toBe(1);
      expect(fake.createdContainers).toHaveLength(1);
    });

    it("queda antes do media_publish: reaproveita o container pronto e publica uma vez", async () => {
      const post = await seed({ attempts: 1 });
      const containerId = await api.createImageContainer(igUserId, FAKE_META_LONG_TOKEN, {
        imageUrl: "https://midia.exemplo.com/a.jpg",
        kind: "FEED",
      });
      await worker.db.publishContainer.create({
        data: {
          postId: post.id,
          igContainerId: containerId,
          role: "SINGLE",
          postVersion: post.version,
          statusCode: "FINISHED",
          expiresAt: new Date(Date.now() + 20 * 60 * 60_000),
        },
      });

      await run(post);

      expect((await saved(post.id)).status).toBe("PUBLISHED");
      expect(fake.createdContainers).toHaveLength(1);
      expect(fake.publishCalls).toBe(1);
    });

    // Depois de FALHOU → corrigir → reagendar, o container velho tem a legenda velha.
    it("container de outra versão não é reaproveitado", async () => {
      const post = await seed();
      await worker.db.publishContainer.create({
        data: {
          postId: post.id,
          igContainerId: "17900000000",
          role: "SINGLE",
          postVersion: post.version - 1,
          statusCode: "FINISHED",
          expiresAt: new Date(Date.now() + 20 * 60 * 60_000),
        },
      });

      await run(post);

      expect(fake.createdContainers).toHaveLength(1);
      expect((await saved(post.id)).status).toBe("PUBLISHED");
    });
  });

  describe("publish sem resposta (docs/09, o caso difícil)", () => {
    it("publicou e a conexão caiu: fica PUBLICADO pela reconciliação, com uma publicação só", async () => {
      fake.nextPublish("drop-after-publish");
      const post = await seed();

      await run(post);

      const result = await saved(post.id);
      expect(result.status).toBe("PUBLISHED");
      expect(result.publication?.externalId).toBeNull();
      expect(fake.publishedMedia).toHaveLength(1);
      expect(await steps(post.id)).toContain("RECONCILE:SUCCESS");
      // Sem o id da mídia, não há o que medir.
      expect(await worker.boss.findJobs(POST_METRICS_QUEUE)).toHaveLength(0);
    });

    it("caiu sem publicar: tenta de novo, e a próxima publica o mesmo container", async () => {
      fake.nextPublish("drop-before-publish");
      const post = await seed();

      await expect(run(post)).rejects.toMatchObject({ failure: "PUBLISH_UNCERTAIN" });
      expect((await saved(post.id)).status).toBe("PROCESSING");

      await run(post);

      expect((await saved(post.id)).status).toBe("PUBLISHED");
      expect(fake.createdContainers).toHaveLength(1);
      expect(fake.publishedMedia).toHaveLength(1);
    });

    it("caiu sem publicar e o container expirou: FALHOU com a dúvida dita às claras", async () => {
      fake.nextPublish("drop-before-publish");
      const post = await seed();
      await expect(run(post)).rejects.toBeInstanceOf(PublishRetryError);
      fake.setContainerStatus(fake.createdContainers[0]!.id, "EXPIRED");

      await run(post);

      const result = await saved(post.id);
      expect(result.status).toBe("FAILED");
      expect(result.lastErrorCode).toBe("PUBLISH_UNCERTAIN");
      expect(fake.publishCalls).toBe(1);
    });
  });

  describe("classificação de erros (docs/08)", () => {
    it("token inválido: FALHOU na hora, e a conta ganha o sinal", async () => {
      fake.refuseNextCreate({ code: 190 });
      const post = await seed();

      await run(post);

      const result = await saved(post.id);
      expect(result.status).toBe("FAILED");
      expect(result.lastErrorCode).toBe("TOKEN_INVALID");
      expect(result.lastErrorMessage).toBe("meta 190/?");
      expect((await worker.db.account.findUniqueOrThrow({ where: { id: accountId } })).accessLostAt).not.toBeNull();
    });

    /*
     * Os avisos do sino (RF-J03) nascem na transação da falha. Duas postagens da
     * mesma conta caindo pelo mesmo token: dois "publicação falhou", um só "conta
     * sem acesso" — o segundo acharia a conta já marcada.
     */
    it("token inválido avisa quem agendou e o gerente, e a conta sem acesso só uma vez", async () => {
      const agendador = await createTestUser(worker.db, worker.encryptionKey, { permissions: ["POST_EDIT"] });
      const gerente = await createTestUser(worker.db, worker.encryptionKey, { permissions: ["ACCOUNT_MANAGE"] });
      const primeira = await seed();
      const segunda = await seed();
      await worker.db.post.updateMany({
        where: { id: { in: [primeira.id, segunda.id] } },
        data: { scheduledById: agendador.id },
      });

      fake.refuseNextCreate({ code: 190 });
      await run(primeira);
      fake.refuseNextCreate({ code: 190 });
      await run(segunda);

      const avisos = await worker.db.notification.findMany({
        include: { deliveries: { select: { userId: true } } },
        orderBy: { createdAt: "asc" },
      });
      const falhas = avisos.filter((aviso) => aviso.type === "PUBLISH_FAILED");
      const semAcesso = avisos.filter((aviso) => aviso.type === "ACCOUNT_ACCESS_LOST");

      expect(falhas.map((aviso) => aviso.targetId).sort()).toEqual([primeira.id, segunda.id].sort());
      for (const falha of falhas) expect(falha.deliveries.map((d) => d.userId)).toEqual([agendador.id]);
      expect(semAcesso).toHaveLength(1);
      expect(semAcesso[0]).toMatchObject({ targetType: "ACCOUNT", targetId: accountId });
      expect(semAcesso[0]!.deliveries.map((d) => d.userId)).toEqual([gerente.id]);
    });

    it("recuperável não avisa ninguém: a postagem ainda vai ao ar", async () => {
      await createTestUser(worker.db, worker.encryptionKey, { superAdmin: true });
      fake.refuseNextCreate({ code: 4 });
      const post = await seed();

      await expect(run(post)).rejects.toBeInstanceOf(PublishRetryError);

      expect(await worker.db.notification.count()).toBe(0);
    });

    it("Meta não baixou a imagem: FALHOU", async () => {
      fake.refuseNextCreate({ code: 9004, subcode: 2207052 });
      const post = await seed();
      await run(post);
      expect((await saved(post.id)).lastErrorCode).toBe("MEDIA_DOWNLOAD_FAILED");
    });

    it.each([
      [{ code: 4 }, "RATE_LIMITED"],
      [{ code: 2, httpStatus: 503 }, "META_UNSTABLE"],
      [{ code: -1, subcode: 2207032 }, "CONTAINER_CREATE_FAILED"],
    ])("recuperável %o: lança, continua PROCESSANDO e guarda a causa", async (refusal, cause) => {
      fake.refuseNextCreate(refusal);
      const post = await seed();

      await expect(run(post)).rejects.toMatchObject({ failure: cause });

      const result = await saved(post.id);
      expect(result.status).toBe("PROCESSING");
      expect(result.lastErrorCode).toBe(cause);
      // O arrendamento é solto: a retentativa não espera ele vencer.
      expect(result.runId).toBeNull();
    });

    it("container em ERROR: FALHOU", async () => {
      fake.nextContainerStatuses(["ERROR"]);
      const post = await seed();
      await run(post);
      expect((await saved(post.id)).lastErrorCode).toBe("CONTAINER_ERROR");
    });

    it("container ainda processando além de 5 minutos: tenta de novo e reaproveita", async () => {
      fake.nextContainerStatuses(["IN_PROGRESS"]);
      const post = await seed();
      const containerId = await api.createImageContainer(igUserId, FAKE_META_LONG_TOKEN, {
        imageUrl: "https://midia.exemplo.com/a.jpg",
        kind: "FEED",
      });
      await worker.db.publishContainer.create({
        data: {
          postId: post.id,
          igContainerId: containerId,
          role: "SINGLE",
          postVersion: post.version,
          createdAt: minutesAgo(6),
          expiresAt: new Date(Date.now() + 20 * 60 * 60_000),
        },
      });

      await expect(run(post)).rejects.toMatchObject({ failure: "CONTAINER_NOT_READY" });
      fake.setContainerStatus(containerId, "FINISHED");
      await run(post);

      expect((await saved(post.id)).status).toBe("PUBLISHED");
      expect(fake.createdContainers).toHaveLength(1);
    });

    // Antes de aceitar a recusa, confere o container: com ele ainda pronto, a recusa é verdadeira.
    it("recusa clara no publish, com o container ainda pronto: FALHOU", async () => {
      fake.refuseNextPublish({ code: 1234 });
      const post = await seed();

      await run(post);

      expect((await saved(post.id)).lastErrorCode).toBe("META_REFUSED");
      expect(fake.publishedMedia).toHaveLength(0);
    });

    it("9007 no publish: tenta de novo, sem publicar", async () => {
      fake.refuseNextPublish({ code: 9007, subcode: 2207027 });
      const post = await seed();

      await expect(run(post)).rejects.toMatchObject({ failure: "CONTAINER_NOT_READY" });
      expect(fake.publishedMedia).toHaveLength(0);
    });
  });

  describe("atraso", () => {
    it("primeira execução mais de 15 minutos depois do horário: FALHOU sem falar com a Meta", async () => {
      const post = await seed({ scheduledAt: minutesAgo(20) });
      await run(post);
      const result = await saved(post.id);
      expect(result.lastErrorCode).toBe("SYSTEM_UNAVAILABLE");
      expect(fake.createdContainers).toHaveLength(0);
    });

    it("retentativa de uma que começou no horário ainda publica depois dos 15 minutos", async () => {
      const post = await seed({ scheduledAt: minutesAgo(20), attempts: 1 });
      await run(post);
      expect((await saved(post.id)).status).toBe("PUBLISHED");
    });

    it("passou do teto de 45 minutos: FALHOU sem falar com a Meta", async () => {
      const post = await seed({ scheduledAt: minutesAgo(50), attempts: 2 });
      await run(post);
      expect((await saved(post.id)).lastErrorCode).toBe("LATE_CEILING");
      expect(fake.createdContainers).toHaveLength(0);
    });

    it("tentativas esgotadas pela nossa conta: FALHOU com a última causa", async () => {
      const post = await seed({ attempts: 5, lastErrorCode: "RATE_LIMITED" });
      await run(post);
      const result = await saved(post.id);
      expect(result.status).toBe("FAILED");
      expect(result.lastErrorCode).toBe("RATE_LIMITED");
      expect(fake.createdContainers).toHaveLength(0);
    });
  });

  // Roteiro de fogo, teste 11, automatizado: o token não aparece em lugar nenhum.
  it("o token não aparece na auditoria, na postagem nem no log", async () => {
    fake.refuseNextCreate({ code: 190, message: `Invalid token ${FAKE_META_LONG_TOKEN}` });
    const post = await seed();

    await run(post);

    const events = await worker.db.publishEvent.findMany({ where: { postId: post.id } });
    const result = await saved(post.id);
    const everything = JSON.stringify(events) + JSON.stringify(result) + worker.logs.join("\n");
    expect(everything).not.toContain(FAKE_META_LONG_TOKEN);
    expect(JSON.stringify(events)).toContain("Invalid token ***");
  });
});
