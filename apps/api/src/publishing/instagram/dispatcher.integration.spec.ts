import { createTestAccount, createTestPost, createTestUser } from "../../common/testing/factories";
import { ageColumn } from "../../common/testing/reset-database";
import { bootTestWorker, type TestWorker } from "../../common/testing/test-worker";
import { PUBLISH_QUEUE } from "../../queues/queue-names";
import { PostOutcomeStore } from "./post-outcome.store";

const minutesFromNow = (n: number) => new Date(Date.now() + n * 60_000);

/**
 * O despachante contra o Postgres de verdade (docs/15): a transação que muda o
 * status e cria a tarefa, a trava otimista e a cota só se provam com banco real.
 */
describe("despachante", () => {
  let worker: TestWorker;
  let accountId: string;
  let userId: string;

  beforeAll(async () => {
    worker = await bootTestWorker();
  });

  beforeEach(async () => {
    await worker.reset();
    userId = (await createTestUser(worker.db, worker.encryptionKey)).id;
    accountId = (await createTestAccount(worker.db, worker.encryptionKey)).id;
  });

  afterAll(async () => {
    await worker?.close();
  });

  const post = (scheduledAt: Date, extra: Partial<Parameters<typeof createTestPost>[1]> = {}) =>
    createTestPost(worker.db, { accountId, createdById: userId, status: "SCHEDULED", scheduledAt, ...extra });
  const statusOf = async (id: string) => (await worker.db.post.findUniqueOrThrow({ where: { id } })).status;
  const jobsOf = (id: string) => worker.boss.findJobs<{ postId: string; version: number }>(PUBLISH_QUEUE, { key: id });

  it("despacha o que vence até um minuto adiante, com a tarefa no instante exato", async () => {
    const scheduledAt = new Date(Date.now() + 30_000);
    const { id, version } = await post(scheduledAt);

    const report = await worker.dispatcher.dispatchDue();

    expect(report.dispatched).toBe(1);
    expect(await statusOf(id)).toBe("PROCESSING");
    const jobs = await jobsOf(id);
    expect(jobs).toHaveLength(1);
    expect(jobs[0]!.data).toEqual({ postId: id, version });
    expect(jobs[0]!.startAfter.getTime()).toBe(scheduledAt.getTime());
  });

  it("não despacha o que vence daqui a dois minutos", async () => {
    const { id } = await post(minutesFromNow(2));
    await worker.dispatcher.dispatchDue();
    expect(await statusOf(id)).toBe("SCHEDULED");
    expect(await jobsOf(id)).toHaveLength(0);
  });

  // Camada 3: duas varreduras ao mesmo tempo, uma transição e uma tarefa.
  it("dois despachantes em paralelo despacham uma vez só", async () => {
    const { id } = await post(new Date());

    const reports = await Promise.all([worker.dispatcher.dispatchDue(), worker.dispatcher.dispatchDue()]);

    expect(reports[0].dispatched + reports[1].dispatched).toBe(1);
    expect(await jobsOf(id)).toHaveLength(1);
    expect(await worker.db.publishEvent.count({ where: { postId: id, step: "DISPATCH", result: "SUCCESS" } })).toBe(1);
  });

  // A pessoa reagendou entre a leitura da varredura e a transição.
  it("não despacha a versão que a varredura leu se ela mudou", async () => {
    const { id, version } = await post(new Date());
    await worker.db.post.update({ where: { id }, data: { version: version + 1 } });

    const moved = await worker.db.$transaction((tx) => worker.context.get(PostOutcomeStore).dispatch(tx, id, version));

    expect(moved).toBe(false);
    expect(await statusOf(id)).toBe("SCHEDULED");
  });

  // Roteiro de fogo, teste 7: o sistema ficou fora do ar, e nada sai atrasado.
  it("postagem vencida há 20 minutos vai para FALHOU como sistema indisponível, sem tarefa", async () => {
    const { id } = await post(minutesFromNow(-20));

    const report = await worker.dispatcher.dispatchDue();

    expect(report.failed).toBe(1);
    const saved = await worker.db.post.findUniqueOrThrow({ where: { id } });
    expect(saved.status).toBe("FAILED");
    expect(saved.lastErrorCode).toBe("SYSTEM_UNAVAILABLE");
    expect(await jobsOf(id)).toHaveLength(0);
    expect(await worker.db.publishEvent.count({ where: { postId: id, step: "DISPATCH", result: "FATAL_ERROR" } })).toBe(1);
  });

  describe("cota (RF-D09)", () => {
    async function publishedToday(count: number) {
      for (let i = 0; i < count; i += 1) {
        const { id } = await createTestPost(worker.db, { accountId, createdById: userId, status: "PUBLISHED" });
        await worker.db.publication.create({ data: { postId: id, externalId: `m${i}`, publishedAt: new Date() } });
      }
    }

    it("sem cota, a postagem fica agendada com o motivo, registrado uma vez só", async () => {
      await publishedToday(45);
      const { id } = await post(new Date());

      await worker.dispatcher.dispatchDue();
      await worker.dispatcher.dispatchDue();

      const saved = await worker.db.post.findUniqueOrThrow({ where: { id } });
      expect(saved.status).toBe("SCHEDULED");
      expect(saved.lastErrorCode).toBe("QUOTA_DEFERRED");
      expect(await worker.db.publishEvent.count({ where: { postId: id, step: "DISPATCH" } })).toBe(1);
    });

    it("adiada por cota além de 15 minutos, falha por cota — não por queda", async () => {
      await publishedToday(45);
      const { id } = await post(minutesFromNow(-20), { lastErrorCode: "QUOTA_DEFERRED" });

      await worker.dispatcher.dispatchDue();

      expect((await worker.db.post.findUniqueOrThrow({ where: { id } })).lastErrorCode).toBe("QUOTA_EXCEEDED");
    });

    // RNF-04: dez vencendo juntas não passam todas pela mesma contagem.
    it("com 44 usadas, de três vencendo juntas só uma sai", async () => {
      await publishedToday(44);
      await post(new Date());
      await post(new Date());
      await post(new Date());

      const report = await worker.dispatcher.dispatchDue();

      expect(report.dispatched).toBe(1);
      expect(report.deferred).toBe(2);
    });

    it("publicação de mais de 24 horas não conta", async () => {
      await publishedToday(45);
      for (const publication of await worker.db.publication.findMany()) {
        await ageColumn(worker.db, "Publicacao", "publicadoEm", publication.id, "25 hours");
      }
      const { id } = await post(new Date());

      await worker.dispatcher.dispatchDue();

      expect(await statusOf(id)).toBe("PROCESSING");
    });
  });

  // A duplicata não lança no pg-boss; sem o throw, a postagem ficaria PROCESSANDO sem tarefa.
  it("com tarefa antiga ocupando a vaga, desfaz e deixa para a próxima varredura", async () => {
    const { id, version } = await post(new Date());
    await worker.boss.send(PUBLISH_QUEUE, { postId: id, version }, { singletonKey: id });

    const report = await worker.dispatcher.dispatchDue();

    expect(report.dispatched).toBe(0);
    expect(await statusOf(id)).toBe("SCHEDULED");
    expect(await jobsOf(id)).toHaveLength(1);
  });

  describe("recolher postagens sem dono", () => {
    it("PROCESSANDO sem arrendamento e sem tarefa ganha tarefa de novo", async () => {
      const { id, version } = await createTestPost(worker.db, { accountId, createdById: userId });

      const report = await worker.dispatcher.dispatchDue();

      expect(report.requeued).toBe(1);
      expect((await jobsOf(id))[0]!.data).toEqual({ postId: id, version });
    });

    it("com tarefa viva, não cria outra", async () => {
      const { id, version } = await createTestPost(worker.db, { accountId, createdById: userId });
      await worker.boss.send(PUBLISH_QUEUE, { postId: id, version }, { singletonKey: id });

      expect((await worker.dispatcher.dispatchDue()).requeued).toBe(0);
      expect(await jobsOf(id)).toHaveLength(1);
    });

    it("com arrendamento válido, alguém cuida dela — não mexe", async () => {
      const { id } = await createTestPost(worker.db, { accountId, createdById: userId });
      await worker.db.post.update({
        where: { id },
        data: { runId: "0190a000-0000-7000-8000-000000000001", runLeaseUntil: minutesFromNow(3) },
      });

      expect((await worker.dispatcher.dispatchDue()).requeued).toBe(0);
    });
  });
});
