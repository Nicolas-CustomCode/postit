import { POST_STATUSES, type Permission } from "./domain";
import { canApprovePost, selfApprovalRefused } from "./permissions";
import { canDeleteComment, createCommentSchema, rejectPostSchema } from "./post-schemas";
import { pageStepFor, postSteps } from "./post-steps";

const pessoa = (permissions: readonly Permission[], superAdmin = false, id = "eu") => ({ id, permissions, superAdmin });

/** As duas etapas da página da postagem (ADR 0026). */
describe("postSteps", () => {
  it.each([
    ["DRAFT", ["current", "pending"]],
    ["IN_REVIEW", ["done", "current"]],
    ["APPROVED", ["done", "current"]],
    ["SCHEDULED", ["done", "done"]],
    ["PROCESSING", ["done", "done"]],
    ["PUBLISHED", ["done", "done"]],
    ["FAILED", ["done", "done"]],
    ["CANCELED", ["off", "off"]],
  ] as const)("%s → %j", (status, etapas) => {
    expect(postSteps(status)).toEqual(etapas);
  });

  it("todo estado tem resposta", () => {
    for (const status of POST_STATUSES) expect(postSteps(status)).toHaveLength(2);
  });
});

describe("pageStepFor", () => {
  it("rascunho abre na Composição para quem edita", () => {
    expect(pageStepFor("DRAFT", pessoa(["POST_EDIT"]))).toBe("compose");
    expect(pageStepFor("DRAFT", pessoa([], true))).toBe("compose");
  });

  it("quem não edita cai na Revisão, mesmo num rascunho", () => {
    expect(pageStepFor("DRAFT", pessoa([]))).toBe("review");
    expect(pageStepFor("DRAFT", pessoa(["POST_APPROVE", "POST_SCHEDULE"]))).toBe("review");
  });

  it("fora do rascunho, sempre a Revisão — editar é voltar para a composição", () => {
    for (const status of POST_STATUSES.filter((s) => s !== "DRAFT")) {
      expect(pageStepFor(status, pessoa([], true))).toBe("review");
    }
  });
});

describe("canApprovePost — autoaprovação (RF-E02; ADR 0015)", () => {
  it("postagem de outra pessoa: basta POSTAGEM_APROVAR", () => {
    expect(canApprovePost(pessoa(["POST_APPROVE"]), "outra")).toBe(true);
    expect(canApprovePost(pessoa(["POST_EDIT"]), "outra")).toBe(false);
  });

  it("a própria exige também POSTAGEM_APROVAR_PROPRIA", () => {
    expect(canApprovePost(pessoa(["POST_APPROVE"]), "eu")).toBe(false);
    expect(canApprovePost(pessoa(["POST_APPROVE", "POST_APPROVE_OWN"]), "eu")).toBe(true);
  });

  it("POSTAGEM_APROVAR_PROPRIA sozinha não aprova nada", () => {
    expect(canApprovePost(pessoa(["POST_APPROVE_OWN"]), "eu")).toBe(false);
  });

  it("super admin aprova a própria", () => {
    expect(canApprovePost(pessoa([], true), "eu")).toBe(true);
    expect(selfApprovalRefused(pessoa([], true), "eu")).toBe(false);
  });
});

describe("os schemas da revisão", () => {
  it("reprovar sem motivo — ou só com espaços — é recusado (RF-E03)", () => {
    expect(rejectPostSchema.safeParse({ version: 1, reason: "" }).success).toBe(false);
    expect(rejectPostSchema.safeParse({ version: 1, reason: "   " }).success).toBe(false);
    expect(rejectPostSchema.safeParse({ version: 1, reason: " A foto 2 está escura " }).data?.reason).toBe(
      "A foto 2 está escura",
    );
  });

  it("o motivo tem teto de 1000", () => {
    expect(rejectPostSchema.safeParse({ version: 1, reason: "a".repeat(1000) }).success).toBe(true);
    expect(rejectPostSchema.safeParse({ version: 1, reason: "a".repeat(1001) }).success).toBe(false);
  });

  it("comentário vazio ou longo demais é recusado, e não leva versão", () => {
    expect(createCommentSchema.safeParse({ text: "  " }).success).toBe(false);
    expect(createCommentSchema.safeParse({ text: "a".repeat(2001) }).success).toBe(false);
    expect(createCommentSchema.safeParse({ text: "ok", version: 1 }).success).toBe(false);
    expect(createCommentSchema.safeParse({ text: "Fica para o story" }).success).toBe(true);
  });
});

describe("canDeleteComment — 5 minutos, e só de quem escreveu", () => {
  const escrito = new Date("2026-09-23T12:00:00Z");
  const depois = (ms: number) => new Date(escrito.getTime() + ms);
  const comentario = { authorId: "eu", at: escrito.toISOString() };

  it("quem escreveu exclui até 5 minutos depois, inclusive", () => {
    expect(canDeleteComment(comentario, "eu", depois(0))).toBe(true);
    expect(canDeleteComment(comentario, "eu", depois(5 * 60_000))).toBe(true);
  });

  it("um instante depois dos 5 minutos, não", () => {
    expect(canDeleteComment(comentario, "eu", depois(5 * 60_000 + 1))).toBe(false);
  });

  it("outra pessoa nunca exclui", () => {
    expect(canDeleteComment(comentario, "outra", depois(0))).toBe(false);
  });
});
