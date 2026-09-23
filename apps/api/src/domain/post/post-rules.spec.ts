import { IMAGE_MIME, POST_STATUSES, selfApprovalRefused, type PostStatus } from "@repo/shared";
import { postReadinessProblem } from "./post-readiness";
import { trailActionFor } from "./post-trail";
import { canCancel, resolveSchedule, scheduleMoveFor } from "./schedule";
import {
  APPROVE_AND_SCHEDULE,
  canApproveAndSchedule,
  canMarkReady,
  canReopen,
  canTransition,
  canUnschedule,
  holdsMedia,
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
    // Cancelar o agendamento sem perder a aprovação (ADR 0026).
    ["SCHEDULED", "APPROVED"],
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

    // ADR 0026: sem isso, editar a postagem de um colega em revisão e aprová-la em seguida passaria.
    it("editar em EM_REVISAO derruba para RASCUNHO", () => {
      expect(statusAfterContentEdit("IN_REVIEW")).toBe("DRAFT");
    });

    it("editar em RASCUNHO não muda nada", () => {
      expect(statusAfterContentEdit("DRAFT")).toBe("DRAFT");
    });

    // Decisão de 22/09/2026: a versão aprovada era a que falhou; corrigir é conteúdo novo.
    it("editar em FALHOU derruba para RASCUNHO", () => {
      expect(statusAfterContentEdit("FAILED")).toBe("DRAFT");
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

  /*
   * A 1e (ADR 0026) separa enviar de aprovar, e junta aprovar e agendar numa
   * decisão só — de novo sem aresta inventada.
   */
  describe("APPROVE_AND_SCHEDULE — aprovar e agendar", () => {
    it("o caminho é revisão → aprovado → agendado", () => {
      expect(APPROVE_AND_SCHEDULE).toEqual(["APPROVED", "SCHEDULED"]);
    });

    it("não existe atalho de revisão direto para agendado", () => {
      expect(canTransition("IN_REVIEW", "SCHEDULED")).toBe(false);
    });

    it("só o que está em revisão se aprova e agenda", () => {
      expect(POST_STATUSES.filter((status) => canApproveAndSchedule(status))).toEqual(["IN_REVIEW"]);
    });
  });

  describe("canReopen — voltar para a composição", () => {
    it("vale em revisão, aprovada e agendada", () => {
      expect(POST_STATUSES.filter((status) => canReopen(status))).toEqual(["IN_REVIEW", "APPROVED", "SCHEDULED"]);
    });

    it("cada uma tem a aresta para RASCUNHO", () => {
      for (const status of ["IN_REVIEW", "APPROVED", "SCHEDULED"] as const) {
        expect(canTransition(status, "DRAFT")).toBe(true);
      }
    });

    /*
     * A aresta FALHOU → RASCUNHO existe, mas é outra porta, com outra permissão:
     * decidir sobre falha é POSTAGEM_AGENDAR (ADR 0015).
     */
    it("falhou não passa por esta porta, ainda que a aresta exista", () => {
      expect(canReopen("FAILED")).toBe(false);
      expect(canTransition("FAILED", "DRAFT")).toBe(true);
    });
  });

  describe("canUnschedule — cancelar o agendamento", () => {
    it("só de agendada, e volta para aprovada", () => {
      expect(POST_STATUSES.filter((status) => canUnschedule(status))).toEqual(["SCHEDULED"]);
      expect(canTransition("SCHEDULED", "APPROVED")).toBe(true);
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

  /**
   * Quem segura a mídia, para a exclusão do acervo (RF-B07).
   *
   * Varrendo `POST_STATUSES`: um estado novo no enum **obriga** a decidir de que
   * lado ele fica, em vez de herdar um `true` por acaso.
   */
  describe("holdsMedia", () => {
    it("só a postagem descartada solta a imagem", () => {
      expect(POST_STATUSES.filter((status) => !holdsMedia(status))).toEqual(["CANCELED"]);
    });

    /*
     * O caso que separa `holdsMedia` de `isEditable`: `PROCESSANDO` não aceita
     * edição, mas é a que mais segura a mídia — o worker está subindo o arquivo.
     */
    it("publicada e em processamento seguram", () => {
      expect(holdsMedia("PUBLISHED")).toBe(true);
      expect(holdsMedia("PROCESSING")).toBe(true);
    });
  });
});

/**
 * O rastro de cada decisão humana (ADR 0026, decisão 3): toda mudança de status
 * feita por uma pessoa deixa uma linha em `Aprovacao`.
 */
describe("trailActionFor", () => {
  it.each([
    ["DRAFT", "IN_REVIEW", "SUBMITTED_FOR_REVIEW"],
    ["IN_REVIEW", "APPROVED", "APPROVED"],
    // Aprovar e agendar é uma decisão só: a linha é a aprovação, com o horário junto.
    ["IN_REVIEW", "SCHEDULED", "APPROVED"],
    ["APPROVED", "SCHEDULED", "SCHEDULED"],
    ["FAILED", "SCHEDULED", "SCHEDULED"],
    ["SCHEDULED", "SCHEDULED", "SCHEDULED"],
    ["SCHEDULED", "APPROVED", "UNSCHEDULED"],
    ["IN_REVIEW", "DRAFT", "RETURNED_TO_DRAFT"],
    ["APPROVED", "DRAFT", "RETURNED_TO_DRAFT"],
    ["SCHEDULED", "DRAFT", "RETURNED_TO_DRAFT"],
    ["FAILED", "DRAFT", "RETURNED_TO_DRAFT"],
    ["DRAFT", "CANCELED", "CANCELED"],
    ["SCHEDULED", "CANCELED", "CANCELED"],
  ] as const)("%s → %s grava %s", (de, para, acao) => {
    expect(trailActionFor(de, para)).toBe(acao);
  });

  it("voltar da revisão com motivo é reprovar", () => {
    expect(trailActionFor("IN_REVIEW", "DRAFT", { reason: "A foto 2 está escura" })).toBe("REJECTED");
  });

  it("o motivo só faz reprovação a partir da revisão", () => {
    expect(trailActionFor("SCHEDULED", "DRAFT", { reason: "qualquer" })).toBe("RETURNED_TO_DRAFT");
  });

  it("o que o worker faz não é decisão humana", () => {
    for (const para of ["PROCESSING", "PUBLISHED", "FAILED"] as const) {
      expect(trailActionFor("SCHEDULED", para)).toBeNull();
    }
  });

  it("toda transição humana da máquina tem ação", () => {
    const doWorker: readonly PostStatus[] = ["PROCESSING", "PUBLISHED", "FAILED"];
    for (const de of POST_STATUSES) {
      for (const para of POST_STATUSES) {
        if (!canTransition(de, para) || doWorker.includes(para)) continue;
        expect({ de, para, temAcao: trailActionFor(de, para) !== null }).toEqual({ de, para, temAcao: true });
      }
    }
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

  /*
   * Carrossel não é formato, é quantidade (ADR 0024): o mesmo `FEED` que aceita
   * uma imagem aceita dez, e a décima primeira é que não cabe.
   */
  it("dez imagens no feed estão prontas; onze não", () => {
    const dez = Array.from({ length: 10 }, () => imagemDeFeed);

    expect(postReadinessProblem({ format: "FEED", caption: null, media: dez })).toBeNull();
    expect(postReadinessProblem({ format: "FEED", caption: null, media: [...dez, imagemDeFeed] })).toBe(
      "POST_TOO_MANY_MEDIA",
    );
  });

  it("Stories com duas imagens é recusado: lá cada mídia é uma publicação", () => {
    expect(
      postReadinessProblem({ format: "STORIES", caption: null, media: [imagemDeStories, imagemDeStories] }),
    ).toBe("POST_FORMAT_SINGLE_MEDIA");
  });

  /*
   * Onze imagens, e uma delas 9:16: as duas regras reprovam. Reclamar da
   * proporção mandaria trocar uma foto, e trocar a foto deixaria a postagem com
   * onze imagens do mesmo jeito. Quantidade primeiro, porque é o que resolve.
   */
  it("a quantidade é conferida antes da proporção", () => {
    const onze = [...Array.from({ length: 10 }, () => imagemDeFeed), imagemDeStories];

    expect(postReadinessProblem({ format: "FEED", caption: null, media: onze })).toBe("POST_TOO_MANY_MEDIA");
  });

  it("uma imagem ruim no meio do carrossel reprova o carrossel", () => {
    expect(
      postReadinessProblem({
        format: "FEED",
        caption: null,
        media: [imagemDeFeed, imagemDeFeed, imagemDeStories],
      }),
    ).toBe("MEDIA_RATIO_UNSUPPORTED");
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
