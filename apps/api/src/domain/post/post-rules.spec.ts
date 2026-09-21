import { IMAGE_MIME, POST_STATUSES, type PostStatus } from "@repo/shared";
import { selfApprovalRefused } from "./approval-rules";
import { postReadinessProblem } from "./post-readiness";
import { canCancel, resolveSchedule, scheduleMoveFor } from "./schedule";
import {
  canMarkReady,
  canTransition,
  isEditable,
  keepsSchedule,
  READY_CHAIN,
  statusAfterContentEdit,
} from "./post-state";

/**
 * A máquina de estados da postagem (docs/05).
 *
 * O teste que mais rende do projeto: a matriz inteira, 8 × 8, conferida contra o
 * diagrama. Uma transição aberta por engano aqui vira, lá na frente, uma
 * postagem publicada duas vezes ou uma aprovação que não valia nada.
 */
describe("máquina de estados da postagem", () => {
  /**
   * O diagrama do docs/05, escrito de novo à mão **de propósito**: se o teste
   * importasse a mesma tabela do código, provaria só que a tabela é igual a si
   * mesma.
   */
  const PERMITIDAS: ReadonlyArray<readonly [PostStatus, PostStatus]> = [
    ["DRAFT", "IN_REVIEW"],
    ["DRAFT", "CANCELED"],
    ["IN_REVIEW", "DRAFT"],
    ["IN_REVIEW", "APPROVED"],
    ["APPROVED", "SCHEDULED"],
    ["APPROVED", "DRAFT"],
    ["SCHEDULED", "DRAFT"],
    ["SCHEDULED", "PROCESSING"],
    ["SCHEDULED", "CANCELED"],
    ["SCHEDULED", "FAILED"],
    ["PROCESSING", "PUBLISHED"],
    ["PROCESSING", "FAILED"],
    ["FAILED", "SCHEDULED"],
    ["FAILED", "DRAFT"],
    ["FAILED", "CANCELED"],
  ];

  const permitida = (de: PostStatus, para: PostStatus) =>
    PERMITIDAS.some(([a, b]) => a === de && b === para);

  it("a matriz inteira bate com o diagrama, nos 64 pares", () => {
    for (const de of POST_STATUSES) {
      for (const para of POST_STATUSES) {
        expect({ de, para, pode: canTransition(de, para) }).toEqual({
          de,
          para,
          pode: permitida(de, para),
        });
      }
    }
  });

  /*
   * As invariantes, uma a uma. Elas já estão cobertas pela matriz acima, mas
   * ganham teste próprio porque a mensagem de falha precisa dizer QUAL regra
   * quebrou — "o par APROVADO→AGENDADO mudou" não conta a mesma história que
   * "I-1 quebrou".
   */
  describe("as invariantes do docs/05", () => {
    it("I-1: só APROVADO chega a AGENDADO", () => {
      const quemAgenda = POST_STATUSES.filter((status) => canTransition(status, "SCHEDULED"));
      // FALHOU reagenda por ação humana (I-4), e é o outro caminho legítimo.
      expect(quemAgenda).toEqual(["APPROVED", "FAILED"]);
    });

    it("I-3: nada sai de PUBLICADO", () => {
      for (const destino of POST_STATUSES) {
        expect(canTransition("PUBLISHED", destino)).toBe(false);
      }
    });

    it("CANCELADO também é terminal", () => {
      for (const destino of POST_STATUSES) {
        expect(canTransition("CANCELED", destino)).toBe(false);
      }
    });

    it("I-4: de FALHOU só se sai para estados que exigem decisão humana", () => {
      expect(POST_STATUSES.filter((status) => canTransition("FAILED", status))).toEqual([
        "DRAFT",
        "SCHEDULED",
        "CANCELED",
      ]);
      // E nunca direto para PROCESSANDO: o worker não reagenda sozinho.
      expect(canTransition("FAILED", "PROCESSING")).toBe(false);
    });

    it("PROCESSANDO só termina em PUBLICADO ou FALHOU", () => {
      expect(POST_STATUSES.filter((status) => canTransition("PROCESSING", status))).toEqual([
        "PUBLISHED",
        "FAILED",
      ]);
    });
  });

  /*
   * I-2 — a que impede aprovar uma coisa e publicar outra (RF-E05).
   */
  describe("statusAfterContentEdit — a invariante I-2", () => {
    it("editar em APROVADO derruba para RASCUNHO", () => {
      expect(statusAfterContentEdit("APPROVED")).toBe("DRAFT");
    });

    it("editar em AGENDADO derruba para RASCUNHO", () => {
      expect(statusAfterContentEdit("SCHEDULED")).toBe("DRAFT");
    });

    it("editar em RASCUNHO não muda nada", () => {
      expect(statusAfterContentEdit("DRAFT")).toBe("DRAFT");
    });

    it("editar em FALHOU mantém FALHOU: quem corrige ainda precisa reagendar", () => {
      expect(statusAfterContentEdit("FAILED")).toBe("FAILED");
    });

    it("o resultado é sempre um estado editável ou o mesmo de antes", () => {
      for (const status of POST_STATUSES) {
        const depois = statusAfterContentEdit(status);
        expect(depois === status || depois === "DRAFT").toBe(true);
      }
    });
  });

  /*
   * A autoaprovação da Fase 1b: duas transições legais encadeadas, e NENHUMA
   * aresta nova. É o que permite marcar a própria postagem como pronta sem
   * mexer no diagrama do docs/05 nem abrir uma aresta que a Fase 4 teria de
   * fechar depois.
   */
  describe("READY_CHAIN — marcar como pronta", () => {
    it("o caminho é rascunho → revisão → aprovado", () => {
      expect(READY_CHAIN).toEqual(["IN_REVIEW", "APPROVED"]);
    });

    it("cada passo do caminho é uma transição que o diagrama já tem", () => {
      expect(canTransition("DRAFT", "IN_REVIEW")).toBe(true);
      expect(canTransition("IN_REVIEW", "APPROVED")).toBe(true);
    });

    it("não existe atalho de rascunho direto para aprovado", () => {
      expect(canTransition("DRAFT", "APPROVED")).toBe(false);
    });

    it("só rascunho pode ser marcado como pronto", () => {
      expect(POST_STATUSES.filter((status) => canMarkReady(status))).toEqual(["DRAFT"]);
    });
  });

  describe("isEditable", () => {
    it("os três estados que não aceitam edição de conteúdo", () => {
      expect(POST_STATUSES.filter((status) => !isEditable(status))).toEqual([
        "PROCESSING",
        "PUBLISHED",
        "CANCELED",
      ]);
    });

    it("rascunho, revisão, aprovado, agendado e falhou aceitam", () => {
      for (const status of ["DRAFT", "IN_REVIEW", "APPROVED", "SCHEDULED", "FAILED"] as const) {
        expect(isEditable(status)).toBe(true);
      }
    });
  });
});

/**
 * Marcar horário (RF-D01, RF-D03, RF-D04; ADR 0006).
 *
 * A aritmética de fuso tem spec próprio em `domain/time/zone.spec.ts`; aqui se
 * prova a **política**.
 */
describe("agendar", () => {
  const SP = "America/Sao_Paulo";
  const agora = new Date("2026-09-20T12:00:00Z"); // 09:00 em São Paulo

  describe("resolveSchedule", () => {
    it("um horário futuro vira instante em UTC", () => {
      const resultado = resolveSchedule({ day: "2026-10-15", time: "10:00", timeZone: SP, now: agora });
      expect(resultado).toEqual({ instant: new Date("2026-10-15T13:00:00.000Z") });
    });

    it("horário no passado é recusado", () => {
      const resultado = resolveSchedule({ day: "2026-09-20", time: "08:00", timeZone: SP, now: agora });
      expect(resultado).toEqual({ problem: "SCHEDULE_IN_PAST" });
    });

    /*
     * A granularidade é o minuto, porque é o que o campo da tela entrega.
     * Recusar "agora" por causa dos segundos que a pessoa levou para clicar
     * seria hostil sem proteger nada — a invariante I-8 tolera 15 minutos.
     */
    it("o minuto corrente é aceito, mesmo com segundos já corridos", () => {
      const meioDoMinuto = new Date("2026-09-20T12:00:43Z");
      const resultado = resolveSchedule({ day: "2026-09-20", time: "09:00", timeZone: SP, now: meioDoMinuto });

      expect(resultado).toEqual({ instant: new Date("2026-09-20T12:00:00.000Z") });
    });

    it("o minuto anterior é recusado", () => {
      const resultado = resolveSchedule({ day: "2026-09-20", time: "08:59", timeZone: SP, now: agora });
      expect(resultado).toEqual({ problem: "SCHEDULE_IN_PAST" });
    });

    it("horário que não existe na transição é recusado, não ajustado", () => {
      const resultado = resolveSchedule({
        day: "2026-10-25",
        time: "01:30",
        timeZone: "Europe/Lisbon",
        now: agora,
      });
      // Este existe duas vezes: fica a primeira.
      expect(resultado).toEqual({ instant: new Date("2026-10-25T00:30:00.000Z") });

      const buraco = resolveSchedule({
        day: "2027-03-28",
        time: "01:30",
        timeZone: "Europe/Lisbon",
        now: agora,
      });
      expect(buraco).toEqual({ problem: "SCHEDULE_TIME_DOES_NOT_EXIST" });
    });
  });

  /*
   * O teste que prova que a aresta não voltou. Na 1b eu inventei uma
   * `RASCUNHO → APROVADO` que não existia no diagrama; aqui o reagendamento
   * poderia tentar a mesma coisa com `AGENDADO → AGENDADO`.
   */
  describe("scheduleMoveFor — e a aresta que não existe", () => {
    it("reagendar não é transição: o estado continua o mesmo", () => {
      expect(scheduleMoveFor("SCHEDULED")).toBe("REPLACE_TIME");
      expect(canTransition("SCHEDULED", "SCHEDULED")).toBe(false);
    });

    it("de APROVADO é transição — a aresta que a invariante I-1 exige", () => {
      expect(scheduleMoveFor("APPROVED")).toBe("TRANSITION");
    });

    it("de FALHOU também, que é o humano reagendando (I-4)", () => {
      expect(scheduleMoveFor("FAILED")).toBe("TRANSITION");
    });

    it("nos demais estados não dá para marcar horário", () => {
      for (const status of ["DRAFT", "IN_REVIEW", "PROCESSING", "PUBLISHED", "CANCELED"] as const) {
        expect(scheduleMoveFor(status)).toBeNull();
      }
    });
  });

  describe("canCancel", () => {
    it("vale em AGENDADO e em FALHOU", () => {
      expect(POST_STATUSES.filter((status) => canCancel(status))).toEqual(["SCHEDULED", "FAILED"]);
    });

    /*
     * Rascunho não se cancela: descarta. São portas diferentes para a mesma
     * aresta, com permissões diferentes — POSTAGEM_EDITAR e POSTAGEM_AGENDAR.
     */
    it("rascunho não se cancela, ainda que a aresta para CANCELADO exista", () => {
      expect(canCancel("DRAFT")).toBe(false);
      expect(canTransition("DRAFT", "CANCELED")).toBe(true);
    });
  });

  describe("keepsSchedule — o horário de quem volta a ser rascunho", () => {
    it("os estados editáveis antes de agendar não guardam horário", () => {
      expect(POST_STATUSES.filter((status) => !keepsSchedule(status))).toEqual([
        "DRAFT",
        "IN_REVIEW",
        "APPROVED",
      ]);
    });

    it("o que já saiu, ou está saindo, guarda", () => {
      for (const status of ["SCHEDULED", "PROCESSING", "PUBLISHED", "FAILED", "CANCELED"] as const) {
        expect(keepsSchedule(status)).toBe(true);
      }
    });

    /*
     * O elo com a invariante I-2: editar conteúdo de uma AGENDADO a derruba
     * para RASCUNHO, e é aí que o horário precisa sair junto — senão a tela
     * mostraria horário de saída numa postagem que não vai sair.
     */
    it("editar uma agendada derruba para rascunho e o horário não sobrevive", () => {
      const depois = statusAfterContentEdit("SCHEDULED");

      expect(depois).toBe("DRAFT");
      expect(keepsSchedule(depois)).toBe(false);
    });
  });
});

/**
 * O portão que decide se a postagem sai do rascunho (RF-C01, RF-C03, RF-B03).
 *
 * É aqui que `validateImageFormat`, escrita com o acervo genérico, finalmente
 * decide alguma coisa: o acervo aceita 9:16, o feed não.
 */
describe("prontidão da postagem", () => {
  const imagemDeFeed = { mimeType: IMAGE_MIME, bytes: 1_000_000, width: 1080, height: 1350 };
  const imagemDeStories = { mimeType: IMAGE_MIME, bytes: 1_000_000, width: 1080, height: 1920 };

  it("uma postagem completa está pronta", () => {
    expect(
      postReadinessProblem({ format: "FEED", caption: "Um dia bonito", media: [imagemDeFeed] }),
    ).toBeNull();
  });

  it("legenda vazia não impede: a Meta aceita postagem sem legenda", () => {
    expect(postReadinessProblem({ format: "FEED", caption: null, media: [imagemDeFeed] })).toBeNull();
  });

  it("sem imagem não há o que publicar", () => {
    expect(postReadinessProblem({ format: "FEED", caption: "oi", media: [] })).toBe(
      "POST_MEDIA_REQUIRED",
    );
  });

  /*
   * O caso que liga as duas partes do trabalho: a imagem 9:16 entrou no acervo
   * porque serve a Stories, e é recusada aqui porque esta postagem é de feed.
   */
  it("imagem que não serve ao formato é recusada", () => {
    expect(
      postReadinessProblem({ format: "FEED", caption: null, media: [imagemDeStories] }),
    ).toBe("MEDIA_RATIO_UNSUPPORTED");

    expect(postReadinessProblem({ format: "STORIES", caption: null, media: [imagemDeStories] })).toBeNull();
  });

  it("legenda longa demais impede ficar pronta", () => {
    expect(
      postReadinessProblem({
        format: "FEED",
        caption: "a".repeat(2201),
        media: [imagemDeFeed],
      }),
    ).toBe("POST_CAPTION_TOO_LONG");
  });

  it("a falta de imagem é conferida antes da legenda", () => {
    expect(postReadinessProblem({ format: "FEED", caption: "a".repeat(2201), media: [] })).toBe(
      "POST_MEDIA_REQUIRED",
    );
  });
});

/**
 * Autoaprovação (RF-E02, RF-I04).
 *
 * A matriz inteira: ter ou não a permissão, ser ou não o autor, ser ou não
 * super admin.
 */
describe("aprovar a própria postagem", () => {
  const AUTOR = "autor-1";
  const pessoa = (id: string, permissions: readonly string[], superAdmin = false) =>
    ({ id, permissions: permissions as never, superAdmin }) as never;

  it("aprovar postagem de outra pessoa nunca exige a permissão extra", () => {
    expect(selfApprovalRefused(pessoa("outra", []), AUTOR)).toBe(false);
  });

  it("aprovar a própria, sem POSTAGEM_APROVAR_PROPRIA, é recusado", () => {
    expect(selfApprovalRefused(pessoa(AUTOR, ["POST_APPROVE"]), AUTOR)).toBe(true);
  });

  it("aprovar a própria, com a permissão, passa", () => {
    expect(selfApprovalRefused(pessoa(AUTOR, ["POST_APPROVE", "POST_APPROVE_OWN"]), AUTOR)).toBe(false);
  });

  it("super admin aprova a própria — tem todas as permissões (ADR 0015)", () => {
    expect(selfApprovalRefused(pessoa(AUTOR, [], true), AUTOR)).toBe(false);
  });
});
