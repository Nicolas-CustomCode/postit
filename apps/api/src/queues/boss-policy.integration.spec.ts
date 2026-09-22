import { createDatabase, type Database } from "@repo/database";
import { fromPrisma, PgBoss } from "pg-boss";
import { testDatabaseUrl } from "../common/testing/test-database";
import { BossService } from "./boss.service";
import { PUBLISH_QUEUE } from "./queue-names";

/**
 * O que o pg-boss 12 faz de verdade com as garantias em que o motor se apoia
 * (item V-13 do docs/08).
 *
 * O docs/09 supunha que o `singletonKey` bastava para recusar a segunda tarefa da
 * mesma postagem. Não basta: o índice único só existe nas filas com política. Este
 * arquivo prende as duas coisas — a armadilha e a política que a evita — para uma
 * atualização do pg-boss que mude o comportamento quebrar aqui, e não em produção.
 *
 * Esquema próprio: um worker do e2e ligado no mesmo banco não pega estas tarefas.
 */
const SCHEMA = "pgboss_jest";

describe("pg-boss — políticas de fila e transação (V-13)", () => {
  let boss: PgBoss;
  let database: Database;
  let seq = 0;

  // Nome novo a cada teste: nenhuma tarefa de um teste esbarra no seguinte.
  const queue = () => `teste-${Date.now()}-${++seq}`;

  beforeAll(async () => {
    database = createDatabase(testDatabaseUrl());
    boss = new PgBoss({ connectionString: testDatabaseUrl(), schema: SCHEMA, schedule: false, supervise: false });
    boss.on("error", () => undefined);
    await boss.start();
  });

  afterAll(async () => {
    await boss?.stop();
    await database?.close();
  });

  it("numa fila standard, o singletonKey sozinho aceita duas tarefas da mesma chave", async () => {
    const name = queue();
    await boss.createQueue(name);

    const first = await boss.send(name, { postId: "p1" }, { singletonKey: "p1" });
    const second = await boss.send(name, { postId: "p1" }, { singletonKey: "p1" });

    expect(first).not.toBeNull();
    expect(second).not.toBeNull();
    expect(second).not.toBe(first);
  });

  it("numa fila exclusive, a segunda tarefa da mesma chave é recusada — sem lançar", async () => {
    const name = queue();
    await boss.createQueue(name, { policy: "exclusive" });

    expect(await boss.send(name, { postId: "p1" }, { singletonKey: "p1" })).not.toBeNull();
    expect(await boss.send(name, { postId: "p1" }, { singletonKey: "p1" })).toBeNull();
    expect(await boss.send(name, { postId: "p2" }, { singletonKey: "p2" })).not.toBeNull();
  });

  it("exclusive continua recusando enquanto a tarefa está ativa ou em retentativa", async () => {
    const name = queue();
    await boss.createQueue(name, { policy: "exclusive", retryLimit: 3 });
    await boss.send(name, { postId: "p1" }, { singletonKey: "p1" });

    const [job] = await boss.fetch(name);
    expect(await boss.send(name, { postId: "p1" }, { singletonKey: "p1" })).toBeNull();

    await boss.fail(name, job!.id);
    const [again] = await boss.findJobs(name, { id: job!.id });
    expect(again!.state).toBe("retry");
    expect(await boss.send(name, { postId: "p1" }, { singletonKey: "p1" })).toBeNull();
  });

  // É o que permite reagendar uma postagem que falhou: a tarefa antiga terminou.
  it("exclusive volta a aceitar a chave depois que a tarefa conclui", async () => {
    const name = queue();
    await boss.createQueue(name, { policy: "exclusive" });
    await boss.send(name, { postId: "p1" }, { singletonKey: "p1" });

    const [job] = await boss.fetch(name);
    await boss.complete(name, job!.id);

    expect(await boss.send(name, { postId: "p1" }, { singletonKey: "p1" })).not.toBeNull();
  });

  describe("com a transação do Prisma (fromPrisma)", () => {
    it("a tarefa some junto quando a transação é desfeita", async () => {
      const name = queue();
      await boss.createQueue(name, { policy: "exclusive" });

      await expect(
        database.prisma.$transaction(async (tx) => {
          await boss.send(name, { postId: "p1" }, { singletonKey: "p1", db: fromPrisma(tx) });
          throw new Error("desfaz");
        }),
      ).rejects.toThrow("desfaz");

      expect(await boss.findJobs(name, { key: "p1" })).toHaveLength(0);
    });

    it("a tarefa existe quando a transação confirma", async () => {
      const name = queue();
      await boss.createQueue(name, { policy: "exclusive" });

      await database.prisma.$transaction(async (tx) => {
        await boss.send(name, { postId: "p1" }, { singletonKey: "p1", db: fromPrisma(tx) });
      });

      expect(await boss.findJobs(name, { key: "p1" })).toHaveLength(1);
    });

    /*
     * A duplicata não aborta a transação: o pg-boss usa ON CONFLICT DO NOTHING e
     * devolve null. Quem usa a mesma transação para mudar o status precisa conferir
     * o null e desfazer por conta própria — senão a postagem fica marcada sem tarefa.
     */
    it("a duplicata devolve null e a transação ainda confirma", async () => {
      const name = queue();
      await boss.createQueue(name, { policy: "exclusive" });
      await boss.send(name, { postId: "p1" }, { singletonKey: "p1" });

      const result = await database.prisma.$transaction(async (tx) =>
        boss.send(name, { postId: "p1" }, { singletonKey: "p1", db: fromPrisma(tx) }),
      );

      expect(result).toBeNull();
      expect(await boss.findJobs(name, { key: "p1" })).toHaveLength(1);
    });
  });

  it("a fila de falhas recebe o mesmo dado da tarefa que esgotou as tentativas", async () => {
    const deadLetter = queue();
    const name = queue();
    await boss.createQueue(deadLetter);
    await boss.createQueue(name, { policy: "exclusive", retryLimit: 0, deadLetter });
    await boss.send(name, { postId: "p1" }, { singletonKey: "p1" });

    const [job] = await boss.fetch(name);
    await boss.fail(name, job!.id);

    const [moved] = await boss.fetch<{ postId: string }>(deadLetter);
    expect(moved!.data).toEqual({ postId: "p1" });
  });

  describe("BossService", () => {
    it("cria a fila de publicação como exclusive", async () => {
      const service = new BossService(testDatabaseUrl(), { schema: SCHEMA });
      try {
        await service.onModuleInit();
        expect((await boss.getQueue(PUBLISH_QUEUE))!.policy).toBe("exclusive");
      } finally {
        await service.onModuleDestroy();
      }
    });

    // Melhor não subir do que subir aceitando duas tarefas da mesma postagem.
    it("recusa subir se a fila de publicação existir com outra política", async () => {
      await boss.deleteQueue(PUBLISH_QUEUE);
      await boss.createQueue(PUBLISH_QUEUE);

      const service = new BossService(testDatabaseUrl(), { schema: SCHEMA });
      try {
        await expect(service.onModuleInit()).rejects.toThrow(/política standard/);
      } finally {
        await service.onModuleDestroy();
        await boss.deleteQueue(PUBLISH_QUEUE);
      }
    });
  });
});
