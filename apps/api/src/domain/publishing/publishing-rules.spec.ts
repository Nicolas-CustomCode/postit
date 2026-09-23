import { PUBLISH_FAILURE_CAUSES, PUBLISH_FAILURES } from "@repo/shared";
import { classifyRefusal, classifyUnavailable, type FailureOutcome, type PublishStepName } from "./classify";
import { containerPlan, isReusable, pollDecision, reconcile } from "./container";
import { dispatchDecision, QUOTA_LIMIT, quotaAllows } from "./dispatch";
import { dispatchHorizon, isPastCeiling, isTooLateToStart } from "./lateness";
import { metricMomentsFor } from "./metrics-schedule";
import { publishMilestones } from "./timeline";

const at = (iso: string) => new Date(iso);
const minutes = (base: Date, n: number) => new Date(base.getTime() + n * 60_000);
const seconds = (base: Date, n: number) => new Date(base.getTime() + n * 1000);

describe("regras de publicação", () => {
  const scheduled = at("2026-10-01T13:00:00.000Z");

  describe("atraso (I-8 e o teto de 45 minutos)", () => {
    it.each([
      [14 * 60 + 59, false],
      [15 * 60, false],
      [15 * 60 + 1, true],
    ])("começar %i s depois do horário: tarde demais = %s", (delay, late) => {
      expect(isTooLateToStart(scheduled, seconds(scheduled, delay))).toBe(late);
    });

    it.each([
      [44 * 60 + 59, false],
      [45 * 60, false],
      [45 * 60 + 1, true],
    ])("%i s depois do horário: passou do teto = %s", (delay, past) => {
      expect(isPastCeiling(scheduled, seconds(scheduled, delay))).toBe(past);
    });

    it("antes do horário nunca é atraso", () => {
      expect(isTooLateToStart(scheduled, minutes(scheduled, -30))).toBe(false);
    });

    it("o despachante olha um minuto adiante", () => {
      expect(dispatchHorizon(scheduled)).toEqual(minutes(scheduled, 1));
    });
  });

  describe("cota", () => {
    it("o limite é 50 menos a margem de 10%", () => {
      expect(QUOTA_LIMIT).toBe(45);
    });

    it.each([
      [44, true],
      [45, false],
      [46, false],
    ])("com %i usadas, cabe mais uma = %s", (used, allows) => {
      expect(quotaAllows(used)).toBe(allows);
    });
  });

  describe("decisão do despachante", () => {
    const decide = (delayMinutes: number, quotaAvailable: boolean, deferredForQuota = false) =>
      dispatchDecision({ scheduledAt: scheduled, now: minutes(scheduled, delayMinutes), quotaAvailable, deferredForQuota });

    it("no horário e com cota, despacha", () => {
      expect(decide(0, true)).toEqual({ kind: "DISPATCH" });
    });

    it("sem cota, adia", () => {
      expect(decide(3, false)).toEqual({ kind: "DEFER" });
    });

    it("atrasada demais, falha como sistema indisponível — mesmo com cota", () => {
      expect(decide(20, true)).toEqual({ kind: "FAIL", cause: "SYSTEM_UNAVAILABLE" });
    });

    it("quem esperou cota até vencer falha por cota, não por queda", () => {
      expect(decide(20, false, true)).toEqual({ kind: "FAIL", cause: "QUOTA_EXCEEDED" });
    });
  });

  describe("classificação de erros (docs/08)", () => {
    const refusal = (code: number | null, subcode: number | null = null, status = 400) => ({ status, code, subcode });

    type Case = readonly [string, ReturnType<typeof refusal>, PublishStepName, FailureOutcome];
    const cases: readonly Case[] = [
      ["token inválido", refusal(190), "CREATE_CONTAINER", { kind: "FATAL", cause: "TOKEN_INVALID", flagsAccount: true }],
      ["sessão expirada", refusal(102), "PUBLISH", { kind: "FATAL", cause: "TOKEN_INVALID", flagsAccount: true }],
      ["permissão ausente", refusal(10), "CREATE_CONTAINER", { kind: "FATAL", cause: "PERMISSION_MISSING", flagsAccount: true }],
      ["permissão 200", refusal(200), "PUBLISH", { kind: "FATAL", cause: "PERMISSION_MISSING", flagsAccount: true }],
      ["conta restrita", refusal(25, 2207050), "PUBLISH", { kind: "FATAL", cause: "ACCOUNT_RESTRICTED", flagsAccount: false }],
      ["cota da Meta", refusal(9, 2207042), "PUBLISH", { kind: "FATAL", cause: "QUOTA_EXCEEDED", flagsAccount: false }],
      ["container expirado", refusal(-2, 2207020), "PUBLISH", { kind: "FATAL", cause: "CONTAINER_EXPIRED", flagsAccount: false }],
      ["download falhou", refusal(9004, 2207052), "CREATE_CONTAINER", { kind: "FATAL", cause: "MEDIA_DOWNLOAD_FAILED", flagsAccount: false }],
      ["carrossel fora da faixa", refusal(100, 2207028), "CREATE_CONTAINER", { kind: "FATAL", cause: "CAROUSEL_COUNT", flagsAccount: false }],
      ["imagem grande", refusal(36000, 2207004), "CREATE_CONTAINER", { kind: "FATAL", cause: "MEDIA_REJECTED", flagsAccount: false }],
      ["não é JPEG", refusal(36001, 2207005), "CREATE_CONTAINER", { kind: "FATAL", cause: "MEDIA_REJECTED", flagsAccount: false }],
      ["proporção", refusal(36003, 2207009), "CREATE_CONTAINER", { kind: "FATAL", cause: "MEDIA_REJECTED", flagsAccount: false }],
      ["código desconhecido", refusal(1234), "CREATE_CONTAINER", { kind: "FATAL", cause: "META_REFUSED", flagsAccount: false }],
      ["demorou para baixar", refusal(-2, 2207003), "CREATE_CONTAINER", { kind: "RECOVERABLE", cause: "META_UNSTABLE", discardContainer: false }],
      ["falhou ao criar", refusal(-1, 2207032), "CHECK_STATUS", { kind: "RECOVERABLE", cause: "CONTAINER_CREATE_FAILED", discardContainer: true }],
      ["erro de envio", refusal(-1, 2207053), "CREATE_CONTAINER", { kind: "RECOVERABLE", cause: "META_UNSTABLE", discardContainer: false }],
      ["ainda processando", refusal(9007, 2207027), "PUBLISH", { kind: "RECOVERABLE", cause: "CONTAINER_NOT_READY", discardContainer: false }],
      ...[4, 17, 32, 613].map(
        (code): Case => [
          `limite ${code}`,
          refusal(code),
          "CREATE_CONTAINER",
          { kind: "RECOVERABLE", cause: "RATE_LIMITED", discardContainer: false },
        ],
      ),
      ["5xx ao criar", refusal(2, null, 503), "CREATE_CONTAINER", { kind: "RECOVERABLE", cause: "META_UNSTABLE", discardContainer: false }],
      ["5xx ao consultar", refusal(null, null, 500), "CHECK_STATUS", { kind: "RECOVERABLE", cause: "META_UNSTABLE", discardContainer: false }],
      ["200 estranho ao criar", refusal(null, null, 200), "CREATE_CONTAINER", { kind: "RECOVERABLE", cause: "META_UNSTABLE", discardContainer: false }],
      // No publish, instabilidade pode ter vindo depois de publicar.
      ["5xx ao publicar", refusal(2, null, 503), "PUBLISH", { kind: "AMBIGUOUS" }],
      ["200 estranho ao publicar", refusal(null, null, 200), "PUBLISH", { kind: "AMBIGUOUS" }],
    ];

    it.each(cases)("%s", (_nome, refused, step, outcome) => {
      expect(classifyRefusal(refused, step)).toEqual(outcome);
    });

    it("sem resposta, criar e consultar tentam de novo", () => {
      expect(classifyUnavailable("CREATE_CONTAINER")).toEqual({ kind: "RECOVERABLE", cause: "NETWORK", discardContainer: false });
      expect(classifyUnavailable("CHECK_STATUS")).toEqual({ kind: "RECOVERABLE", cause: "NETWORK", discardContainer: false });
    });

    it("sem resposta no publish, ninguém sabe — reconciliação", () => {
      expect(classifyUnavailable("PUBLISH")).toEqual({ kind: "AMBIGUOUS" });
    });
  });

  describe("container", () => {
    it("uma mídia é container único; duas ou mais, carrossel", () => {
      expect(containerPlan(1)).toEqual({ kind: "SINGLE" });
      expect(containerPlan(3)).toEqual({ kind: "CAROUSEL", items: 3 });
    });

    describe("reaproveitar", () => {
      const now = scheduled;
      const valid = {
        expiresAt: minutes(now, 23 * 60),
        statusCode: "FINISHED" as const,
        postVersion: 4,
        position: 2,
      };
      const wanted = { now, postVersion: 4, position: 2 };

      it("serve quando é da mesma versão e posição, pronto e longe de expirar", () => {
        expect(isReusable(valid, wanted)).toBe(true);
      });

      it("serve ainda em processamento, ou sem estado lido", () => {
        expect(isReusable({ ...valid, statusCode: "IN_PROGRESS" }, wanted)).toBe(true);
        expect(isReusable({ ...valid, statusCode: null }, wanted)).toBe(true);
      });

      // FALHOU → corrigir → reagendar: o container antigo teria a legenda velha.
      it("não serve de outra versão da postagem", () => {
        expect(isReusable(valid, { ...wanted, postVersion: 5 })).toBe(false);
      });

      it("não serve de outra posição do carrossel", () => {
        expect(isReusable(valid, { ...wanted, position: 3 })).toBe(false);
      });

      it("não serve perto de expirar", () => {
        expect(isReusable({ ...valid, expiresAt: minutes(now, 59) }, wanted)).toBe(false);
      });

      it.each(["ERROR", "EXPIRED", "PUBLISHED"] as const)("não serve em %s", (statusCode) => {
        expect(isReusable({ ...valid, statusCode }, wanted)).toBe(false);
      });
    });

    describe("depois de consultar o estado", () => {
      const created = scheduled;

      it("FINISHED segue para publicar", () => {
        expect(pollDecision("FINISHED", created, minutes(created, 1))).toEqual({ kind: "READY" });
      });

      it("IN_PROGRESS espera até 5 minutos de vida do container, e depois desiste desta tentativa", () => {
        expect(pollDecision("IN_PROGRESS", created, seconds(created, 299))).toEqual({ kind: "WAIT" });
        expect(pollDecision("IN_PROGRESS", created, seconds(created, 300))).toEqual({
          kind: "RECOVERABLE",
          cause: "CONTAINER_NOT_READY",
        });
      });

      it("ERROR e EXPIRED são fatais", () => {
        expect(pollDecision("ERROR", created, created)).toEqual({ kind: "FATAL", cause: "CONTAINER_ERROR" });
        expect(pollDecision("EXPIRED", created, created)).toEqual({ kind: "FATAL", cause: "CONTAINER_EXPIRED" });
      });

      it("PUBLISHED nunca leva a publicar de novo", () => {
        expect(pollDecision("PUBLISHED", created, created)).toEqual({ kind: "ALREADY_PUBLISHED" });
      });
    });

    describe("reconciliação depois de um publish sem resposta", () => {
      it.each([
        ["PUBLISHED", "PUBLISHED"],
        ["FINISHED", "RETRY"],
        ["IN_PROGRESS", "RETRY"],
        ["EXPIRED", "UNCERTAIN"],
        ["ERROR", "UNCERTAIN"],
      ] as const)("%s → %s", (statusCode, result) => {
        expect(reconcile(statusCode)).toBe(result);
      });
    });
  });

  describe("momentos das métricas", () => {
    const published = at("2026-10-01T13:02:00.000Z");

    it("Stories: T+1h e T+20h, dentro da janela de 24h", () => {
      expect(metricMomentsFor("STORIES", published)).toEqual([
        { moment: "T1H", startAfter: at("2026-10-01T14:02:00.000Z") },
        { moment: "STORY_20H", startAfter: at("2026-10-02T09:02:00.000Z") },
      ]);
    });

    it("feed: T+1h, T+24h e T+7d", () => {
      expect(metricMomentsFor("FEED", published).map((item) => item.moment)).toEqual(["T1H", "T24H", "T7D"]);
      expect(metricMomentsFor("FEED", published)[2]!.startAfter).toEqual(at("2026-10-08T13:02:00.000Z"));
    });
  });

  // RNF-07: toda causa tem frase em português e um próximo passo.
  it("toda causa de falha tem mensagem", () => {
    for (const cause of PUBLISH_FAILURE_CAUSES) {
      expect(PUBLISH_FAILURES[cause].message.length).toBeGreaterThan(10);
    }
  });
});

/**
 * O diário do motor reduzido ao que a equipe precisa ler na Revisão (ADR 0026).
 */
describe("publishMilestones", () => {
  const ev = (at: string, step: string, result: string) => ({ id: `id-${at}`, at, step, result }) as never;
  const agendada = { status: "SCHEDULED", failureCause: null } as const;

  it("despachar, criar container, conferir e métricas não aparecem; publicar sim", () => {
    const marcos = publishMilestones(
      [
        ev("t1", "DISPATCH", "SUCCESS"),
        ev("t2", "CREATE_CONTAINER", "SUCCESS"),
        ev("t3", "CHECK_STATUS", "SUCCESS"),
        ev("t4", "PUBLISH", "SUCCESS"),
        ev("t5", "COLLECT_METRICS", "FATAL_ERROR"),
      ],
      { status: "PUBLISHED", failureCause: null },
    );

    expect(marcos).toEqual([{ id: "id-t4", at: "t4", outcome: "PUBLISHED", cause: null }]);
  });

  it("a reconciliação que confirma também é publicada", () => {
    expect(publishMilestones([ev("t1", "RECONCILE", "SUCCESS")], agendada)).toEqual([
      { id: "id-t1", at: "t1", outcome: "PUBLISHED", cause: null },
    ]);
  });

  it("tentativas seguidas viram um marco só, na primeira", () => {
    const marcos = publishMilestones(
      [
        ev("t1", "CREATE_CONTAINER", "RECOVERABLE_ERROR"),
        ev("t2", "DISPATCH", "SUCCESS"),
        ev("t3", "PUBLISH", "RECOVERABLE_ERROR"),
        ev("t4", "PUBLISH", "SUCCESS"),
      ],
      agendada,
    );

    expect(marcos.map((m) => [m.at, m.outcome])).toEqual([
      ["t1", "RETRYING"],
      ["t4", "PUBLISHED"],
    ]);
  });

  it("adiar pela cota é espera, não tentativa", () => {
    expect(publishMilestones([ev("t1", "DISPATCH", "RECOVERABLE_ERROR")], agendada)).toEqual([]);
  });

  it("a causa vai só na última falha, e só com a postagem em FALHOU", () => {
    const eventos = [
      ev("t1", "CREATE_CONTAINER", "FATAL_ERROR"),
      ev("t2", "PUBLISH", "RECOVERABLE_ERROR"),
      ev("t3", "GIVE_UP", "FATAL_ERROR"),
    ];

    expect(publishMilestones(eventos, { status: "FAILED", failureCause: "LATE_CEILING" })).toEqual([
      { id: "id-t1", at: "t1", outcome: "FAILED", cause: null },
      { id: "id-t2", at: "t2", outcome: "RETRYING", cause: null },
      { id: "id-t3", at: "t3", outcome: "FAILED", cause: "LATE_CEILING" },
    ]);

    // Reagendada depois da falha: a causa guardada não é mais "a atual".
    expect(publishMilestones(eventos, { status: "SCHEDULED", failureCause: null }).at(-1)?.cause).toBeNull();
  });
});
