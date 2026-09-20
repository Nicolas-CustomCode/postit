import { IMAGE_MIME, POST_STATUSES, type PostStatus } from "@repo/shared";
import { selfApprovalRefused } from "./approval-rules";
import { postReadinessProblem } from "./post-readiness";
import { canMarkReady, canTransition, isEditable, READY_CHAIN, statusAfterContentEdit } from "./post-state";

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
      postReadinessProblem({ format: "FEED_IMAGE", caption: "Um dia bonito", media: [imagemDeFeed] }),
    ).toBeNull();
  });

  it("legenda vazia não impede: a Meta aceita postagem sem legenda", () => {
    expect(postReadinessProblem({ format: "FEED_IMAGE", caption: null, media: [imagemDeFeed] })).toBeNull();
  });

  it("sem imagem não há o que publicar", () => {
    expect(postReadinessProblem({ format: "FEED_IMAGE", caption: "oi", media: [] })).toBe(
      "POST_MEDIA_REQUIRED",
    );
  });

  /*
   * O caso que liga as duas partes do trabalho: a imagem 9:16 entrou no acervo
   * porque serve a Stories, e é recusada aqui porque esta postagem é de feed.
   */
  it("imagem que não serve ao formato é recusada", () => {
    expect(
      postReadinessProblem({ format: "FEED_IMAGE", caption: null, media: [imagemDeStories] }),
    ).toBe("MEDIA_RATIO_UNSUPPORTED");

    expect(postReadinessProblem({ format: "STORIES", caption: null, media: [imagemDeStories] })).toBeNull();
  });

  it("legenda longa demais impede ficar pronta", () => {
    expect(
      postReadinessProblem({
        format: "FEED_IMAGE",
        caption: "a".repeat(2201),
        media: [imagemDeFeed],
      }),
    ).toBe("POST_CAPTION_TOO_LONG");
  });

  it("a falta de imagem é conferida antes da legenda", () => {
    expect(postReadinessProblem({ format: "FEED_IMAGE", caption: "a".repeat(2201), media: [] })).toBe(
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
