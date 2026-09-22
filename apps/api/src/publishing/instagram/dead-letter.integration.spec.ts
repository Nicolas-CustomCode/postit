import type { FastifyInstance } from "fastify";
import { createTestAccount, createTestPost, createTestUser } from "../../common/testing/factories";
import { bootTestWorker, type TestWorker } from "../../common/testing/test-worker";
import { createFakeMeta, FAKE_META_LONG_TOKEN, fakePublishing } from "../../fake-meta/fake-meta";
import { PUBLISH_DEAD_LETTER_QUEUE, PUBLISH_QUEUE } from "../../queues/queue-names";
import type { PublishJobData } from "./dispatcher.service";

/** O tratador de `publicar-instagram-falhas` — e o caminho inteiro até ele, pelo pg-boss. */
describe("tratador de falhas", () => {
  let meta: FastifyInstance;
  let worker: TestWorker;
  let accountId: string;
  let userId: string;

  beforeAll(async () => {
    meta = createFakeMeta("test");
    await meta.listen({ port: 0, host: "127.0.0.1" });
    const address = meta.server.address();
    const base = `http://127.0.0.1:${typeof address === "object" && address ? address.port : 0}`;
    worker = await bootTestWorker({ META_GRAPH_URL: base, META_AUTH_URL: base, META_TOKEN_URL: base });
  });

  beforeEach(async () => {
    await worker.reset();
    fakePublishing(meta).reset();
    userId = (await createTestUser(worker.db, worker.encryptionKey)).id;
    accountId = (await createTestAccount(worker.db, worker.encryptionKey, { token: FAKE_META_LONG_TOKEN })).id;
  });

  afterAll(async () => {
    await worker?.close();
    await meta?.close();
  });

  const seed = (extra: Partial<Parameters<typeof createTestPost>[1]> = {}) =>
    createTestPost(worker.db, { accountId, createdById: userId, ...extra });
  const saved = (id: string) => worker.db.post.findUniqueOrThrow({ where: { id } });

  it("marca FALHOU com a causa da última tentativa", async () => {
    const post = await seed({ attempts: 5, lastErrorCode: "META_UNSTABLE" });

    await worker.deadLetter.run({ postId: post.id, version: post.version });

    const result = await saved(post.id);
    expect(result.status).toBe("FAILED");
    expect(result.lastErrorCode).toBe("META_UNSTABLE");
  });

  it("com a Publicacao gravada, a postagem saiu — acerta o status em vez de falhar", async () => {
    const post = await seed();
    await worker.db.publication.create({ data: { postId: post.id, externalId: "m1", publishedAt: new Date() } });

    await worker.deadLetter.run({ postId: post.id, version: post.version });

    expect((await saved(post.id)).status).toBe("PUBLISHED");
  });

  // Uma tarefa de falha que sobrou do ciclo anterior não derruba o ciclo novo.
  it("de outra versão, não mexe", async () => {
    const post = await seed();
    await worker.deadLetter.run({ postId: post.id, version: post.version - 1 });
    expect((await saved(post.id)).status).toBe("PROCESSING");
  });

  // Alguém ainda a segura: o despachante recolhe depois, se sobrar sem dono.
  it("com o arrendamento de uma execução viva, não mexe", async () => {
    const post = await seed();
    await worker.db.post.update({
      where: { id: post.id },
      data: { runId: "0190a000-0000-7000-8000-000000000001", runLeaseUntil: new Date(Date.now() + 60_000) },
    });

    await worker.deadLetter.run({ postId: post.id, version: post.version });

    expect((await saved(post.id)).status).toBe("PROCESSING");
  });

  it("de ponta a ponta pelo pg-boss: tentativas esgotadas terminam em FALHOU", async () => {
    // Sem repetições nesta execução do teste: a primeira falha já esgota.
    await worker.boss.updateQueue(PUBLISH_QUEUE, { retryLimit: 0 });
    try {
      await worker.boss.work<PublishJobData>(PUBLISH_QUEUE, { pollingIntervalSeconds: 0.5 }, async ([job]) => {
        if (job) await worker.publisher.run(job.data, job.signal);
      });
      await worker.boss.work<PublishJobData>(PUBLISH_DEAD_LETTER_QUEUE, { pollingIntervalSeconds: 0.5 }, async ([job]) => {
        if (job) await worker.deadLetter.run(job.data);
      });

      fakePublishing(meta).refuseNextCreate({ code: 4 });
      const post = await seed();
      await worker.boss.send(PUBLISH_QUEUE, { postId: post.id, version: post.version }, { singletonKey: post.id });

      const deadline = Date.now() + 20_000;
      while ((await saved(post.id)).status === "PROCESSING" && Date.now() < deadline) {
        await new Promise((resolve) => setTimeout(resolve, 200));
      }

      const result = await saved(post.id);
      expect(result.status).toBe("FAILED");
      expect(result.lastErrorCode).toBe("RATE_LIMITED");
    } finally {
      await worker.boss.offWork(PUBLISH_QUEUE);
      await worker.boss.offWork(PUBLISH_DEAD_LETTER_QUEUE);
      await worker.boss.updateQueue(PUBLISH_QUEUE, { retryLimit: 4 });
    }
  });
});
