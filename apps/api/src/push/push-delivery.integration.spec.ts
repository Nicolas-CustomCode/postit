import { randomBytes } from "node:crypto";
import type { NotificationType, PushPayload } from "@repo/shared";
import { createTestUser } from "../common/testing/factories";
import { ageColumn } from "../common/testing/reset-database";
import { bootTestWorker, type TestWorker } from "../common/testing/test-worker";
import { PrismaService } from "../prisma/prisma.service";
import { BossService } from "../queues/boss.service";
import { NOTIFY_QUEUE } from "../queues/queue-names";
import type { PushConfig } from "./push.config";
import { MAX_CONSECUTIVE_FAILURES, PushDeliveryService, type NotifyJobData } from "./push-delivery.service";
import { PushSender, type PushOutcome, type PushTarget } from "./push-sender";

/**
 * O push do lado do worker (RF-J02; ADR 0017), contra o Postgres e o pg-boss de
 * verdade. O envio é roteirizado pelo próprio endereço — `…/ok`, `…/gone`,
 * `…/failed` —, e grava o que recebeu: é assim que se prova que ao aparelho vai
 * **só** título e link (regra 22).
 */
class ScriptedSender extends PushSender {
  readonly sent: { endpoint: string; payload: PushPayload }[] = [];

  send(target: PushTarget, payload: PushPayload): Promise<PushOutcome> {
    this.sent.push({ endpoint: target.endpoint, payload });
    return Promise.resolve(target.endpoint.split("/")[3] as PushOutcome);
  }
}

describe("envio do push", () => {
  let worker: TestWorker;
  let sender: ScriptedSender;
  let push: PushDeliveryService;
  const config: PushConfig = {
    vapid: { publicKey: "p", privateKey: "k", subject: "mailto:x@exemplo.com" },
    sweepMs: 10_000,
    idleDays: 7,
  };

  beforeAll(async () => {
    worker = await bootTestWorker();
  });
  beforeEach(async () => {
    await worker.reset();
    sender = new ScriptedSender();
    push = new PushDeliveryService(
      worker.context.get(PrismaService),
      worker.context.get(BossService),
      sender,
      config,
    );
  });
  afterAll(() => worker.close());

  async function pessoa(): Promise<string> {
    return (await createTestUser(worker.db, worker.encryptionKey)).id;
  }

  /** Uma sessão viva, como o login a deixaria. */
  async function sessao(userId: string, extra: { revokedAt?: Date } = {}): Promise<string> {
    const agora = new Date();
    const linha = await worker.db.session.create({
      data: {
        userId,
        tokenHash: randomBytes(32).toString("hex"),
        expiresAt: new Date(agora.getTime() + 30 * 86_400_000),
        lastUsedAt: agora,
        verifiedAt: agora,
        revokedAt: extra.revokedAt ?? null,
      },
    });
    return linha.id;
  }

  let seq = 0;
  /** Um aparelho inscrito; o resultado do envio vem do endereço. */
  async function aparelho(userId: string, resultado: PushOutcome, sessionId?: string): Promise<string> {
    const linha = await worker.db.pushSubscription.create({
      data: {
        userId,
        sessionId: sessionId ?? (await sessao(userId)),
        endpoint: `https://push.teste/${resultado}/${(seq += 1)}`,
        p256dhKey: "p256dh",
        authKey: "auth",
      },
    });
    return linha.id;
  }

  async function aviso(type: NotificationType, para: readonly string[], idade?: string): Promise<string> {
    const criado = await worker.db.notification.create({
      data: {
        type,
        targetType: "POST",
        targetId: "0190a0b1-0000-7000-8000-000000000000",
        deliveries: { createMany: { data: para.map((userId) => ({ userId })) } },
      },
    });
    if (idade !== undefined) await ageColumn(worker.db, "Notificacao", "criadaEm", criado.id, idade);
    return criado.id;
  }

  /** Varre e roda as tarefas que a varredura criou, como o worker faria. */
  async function varrerEEntregar(): Promise<void> {
    await push.sweep(new Date());
    const tarefas = await worker.boss.findJobs<NotifyJobData>(NOTIFY_QUEUE);
    for (const tarefa of tarefas) await push.deliver(tarefa.data, new Date());
    await worker.boss.deleteAllJobs();
  }

  it("a entrega pendente vai ao aparelho só com título e link, e fica marcada", async () => {
    const ana = await pessoa();
    const inscricao = await aparelho(ana, "ok");
    const id = await aviso("PUBLISH_FAILED", [ana]);

    await varrerEEntregar();

    expect(sender.sent).toEqual([
      { endpoint: expect.stringContaining("/ok/"), payload: { title: "Uma publicação falhou", url: `/notificacoes/${id}` } },
    ]);
    expect(Object.keys(sender.sent[0]!.payload).sort()).toEqual(["title", "url"]);
    expect((await worker.db.notificationDelivery.findFirstOrThrow()).pushSentAt).not.toBeNull();
    expect((await worker.db.pushSubscription.findUniqueOrThrow({ where: { id: inscricao } })).lastSuccessAt).not.toBeNull();

    // A segunda varredura não manda de novo.
    await varrerEEntregar();
    expect(sender.sent).toHaveLength(1);
  });

  it("vai a todos os aparelhos da pessoa, e só dela", async () => {
    const ana = await pessoa();
    const bruno = await pessoa();
    await aparelho(ana, "ok");
    await aparelho(ana, "ok");
    await aparelho(bruno, "ok");
    await aviso("AWAITING_APPROVAL", [ana]);

    await varrerEEntregar();

    expect(sender.sent).toHaveLength(2);
  });

  it("aparelho que o serviço dá como inexistente é apagado", async () => {
    const ana = await pessoa();
    const inscricao = await aparelho(ana, "gone");
    await aviso("PUBLISH_FAILED", [ana]);

    await varrerEEntregar();

    expect(await worker.db.pushSubscription.count({ where: { id: inscricao } })).toBe(0);
  });

  it(`falha soma, e na ${MAX_CONSECUTIVE_FAILURES}ª seguida a inscrição é apagada`, async () => {
    const ana = await pessoa();
    const inscricao = await aparelho(ana, "failed");

    for (let vez = 1; vez < MAX_CONSECUTIVE_FAILURES; vez += 1) {
      await aviso("PUBLISH_FAILED", [ana]);
      await varrerEEntregar();
      expect((await worker.db.pushSubscription.findUniqueOrThrow({ where: { id: inscricao } })).consecutiveFailures).toBe(
        vez,
      );
    }

    await aviso("PUBLISH_FAILED", [ana]);
    await varrerEEntregar();
    expect(await worker.db.pushSubscription.count({ where: { id: inscricao } })).toBe(0);
  });

  it("tipo desligado nas preferências não vai por push, e fica marcado", async () => {
    const ana = await pessoa();
    await aparelho(ana, "ok");
    await worker.db.notificationPreference.create({ data: { userId: ana, type: "AWAITING_APPROVAL", push: false } });
    await aviso("AWAITING_APPROVAL", [ana]);
    await aviso("PUBLISH_FAILED", [ana]);

    await varrerEEntregar();

    expect(sender.sent.map((envio) => envio.payload.title)).toEqual(["Uma publicação falhou"]);
    expect(await worker.db.notificationDelivery.count({ where: { pushSentAt: null } })).toBe(0);
  });

  it("sessão encerrada: a inscrição é apagada sem envio", async () => {
    const ana = await pessoa();
    const encerrada = await sessao(ana, { revokedAt: new Date() });
    const inscricao = await aparelho(ana, "ok", encerrada);
    await aviso("PUBLISH_FAILED", [ana]);

    await varrerEEntregar();

    expect(sender.sent).toEqual([]);
    expect(await worker.db.pushSubscription.count({ where: { id: inscricao } })).toBe(0);
  });

  it("sessão parada além do prazo de inatividade conta como encerrada", async () => {
    const ana = await pessoa();
    const parada = await sessao(ana);
    await worker.db.session.update({
      where: { id: parada },
      data: { lastUsedAt: new Date(Date.now() - 8 * 86_400_000) },
    });
    await aparelho(ana, "ok", parada);
    await aviso("PUBLISH_FAILED", [ana]);

    await varrerEEntregar();

    expect(sender.sent).toEqual([]);
  });

  it("aviso de mais de uma hora é marcado sem envio", async () => {
    const ana = await pessoa();
    await aparelho(ana, "ok");
    await aviso("PUBLISH_FAILED", [ana], "2 hours");

    const resultado = await push.sweep(new Date());

    expect(resultado).toMatchObject({ stale: 1, queued: 0 });
    expect(await worker.boss.findJobs(NOTIFY_QUEUE)).toEqual([]);
    expect(await worker.db.notificationDelivery.count({ where: { pushSentAt: null } })).toBe(0);
  });

  it("duas varreduras ao mesmo tempo não criam a mesma tarefa duas vezes", async () => {
    const pessoas = await Promise.all([pessoa(), pessoa(), pessoa()]);
    for (let n = 0; n < 5; n += 1) await aviso("PUBLISH_FAILED", pessoas);

    const [a, b] = await Promise.all([push.sweep(new Date()), push.sweep(new Date())]);

    expect(a.queued + b.queued).toBe(15);
    const tarefas = await worker.boss.findJobs<NotifyJobData>(NOTIFY_QUEUE);
    const ids = tarefas.map((tarefa) => ("deliveryId" in tarefa.data ? tarefa.data.deliveryId : ""));
    expect(new Set(ids).size).toBe(15);
  });

  it("o push de teste vai uma vez, ao aparelho que pediu, e leva ao Perfil", async () => {
    const ana = await pessoa();
    const inscricao = await aparelho(ana, "ok");
    await aparelho(ana, "ok");
    await worker.db.pushSubscription.update({ where: { id: inscricao }, data: { testRequestedAt: new Date() } });

    await varrerEEntregar();
    await varrerEEntregar();

    expect(sender.sent).toEqual([
      { endpoint: expect.any(String), payload: { title: "Notificações ativas neste aparelho", url: "/perfil" } },
    ]);
    expect((await worker.db.pushSubscription.findUniqueOrThrow({ where: { id: inscricao } })).testRequestedAt).toBeNull();
  });

  it("o endereço da inscrição nunca aparece no log", async () => {
    const ana = await pessoa();
    await aparelho(ana, "gone");
    await aparelho(ana, "failed");
    const encerrada = await sessao(ana, { revokedAt: new Date() });
    await aparelho(ana, "ok", encerrada);
    await aviso("PUBLISH_FAILED", [ana]);

    await varrerEEntregar();

    const log = worker.logs.join("\n");
    // As três saídas escreveram — senão o teste passaria com o log vazio.
    expect(log).toContain("não existe mais");
    expect(log).toContain("falhou");
    expect(log).toContain("sessão que a criou terminou");
    expect(log).not.toContain("push.teste");
  });
});
