import type { Permission } from "@repo/shared";
import { recipientsFor, type Candidate } from "./recipients";

/**
 * Quem recebe cada aviso (RF-J03). Regra pura: os usuários entram como lista, e a
 * lista já é só dos ativos — é assim que o desativado fica de fora.
 */
describe("destinatários dos avisos", () => {
  const pessoa = (id: string, permissions: Permission[] = [], superAdmin = false): Candidate => ({
    id,
    permissions,
    superAdmin,
  });

  const admin = pessoa("admin", [], true);
  const agendador = pessoa("agendador", ["POST_SCHEDULE"]);
  const gerente = pessoa("gerente", ["ACCOUNT_MANAGE"]);
  const aprovador = pessoa("aprovador", ["POST_APPROVE"]);
  const aprovadorDoProprio = pessoa("aprovador-proprio", ["POST_EDIT", "POST_APPROVE", "POST_APPROVE_OWN"]);
  const editor = pessoa("editor", ["POST_EDIT"]);
  const todos = [admin, agendador, gerente, aprovador, aprovadorDoProprio, editor];

  describe("publicação falhou", () => {
    it("quem agendou, quem tem POST_SCHEDULE e os super admins", () => {
      expect(recipientsFor({ type: "PUBLISH_FAILED", scheduledById: "editor" }, todos).sort()).toEqual(
        ["admin", "agendador", "editor"].sort(),
      );
    });

    it("quem agendou e foi desativado não recebe", () => {
      const semEditor = todos.filter((user) => user.id !== "editor");
      expect(recipientsFor({ type: "PUBLISH_FAILED", scheduledById: "editor" }, semEditor)).not.toContain("editor");
    });

    it("sem agendador registrado, só as permissões", () => {
      expect(recipientsFor({ type: "PUBLISH_FAILED", scheduledById: null }, todos).sort()).toEqual(
        ["admin", "agendador"].sort(),
      );
    });

    it("quem agendou e também tem a permissão aparece uma vez", () => {
      expect(recipientsFor({ type: "PUBLISH_FAILED", scheduledById: "agendador" }, todos)).toEqual(
        expect.arrayContaining(["agendador"]),
      );
      expect(
        recipientsFor({ type: "PUBLISH_FAILED", scheduledById: "agendador" }, todos).filter((id) => id === "agendador"),
      ).toHaveLength(1);
    });
  });

  it("conta sem acesso: quem gerencia contas e os super admins", () => {
    expect(recipientsFor({ type: "ACCOUNT_ACCESS_LOST" }, todos).sort()).toEqual(["admin", "gerente"].sort());
  });

  describe("aguardando aprovação", () => {
    it("quem pode aprovar, menos quem enviou", () => {
      expect(
        recipientsFor({ type: "AWAITING_APPROVAL", authorId: "editor", actorId: "editor" }, todos).sort(),
      ).toEqual(["admin", "aprovador", "aprovador-proprio"].sort());
    });

    it("o autor sem POST_APPROVE_OWN não é avisado da própria, mesmo enviada por outra pessoa", () => {
      const autorAprovador = pessoa("autor", ["POST_EDIT", "POST_APPROVE"]);
      expect(
        recipientsFor({ type: "AWAITING_APPROVAL", authorId: "autor", actorId: "editor" }, [...todos, autorAprovador]),
      ).not.toContain("autor");
    });

    it("quem aprova e continua para a revisão não avisa a si mesmo, e avisa os outros", () => {
      const ids = recipientsFor(
        { type: "AWAITING_APPROVAL", authorId: "aprovador-proprio", actorId: "aprovador-proprio" },
        todos,
      );
      expect(ids).not.toContain("aprovador-proprio");
      expect(ids).toEqual(expect.arrayContaining(["admin", "aprovador"]));
    });

    it("sem ninguém que possa aprovar, ninguém recebe", () => {
      expect(recipientsFor({ type: "AWAITING_APPROVAL", authorId: "editor", actorId: "editor" }, [editor])).toEqual(
        [],
      );
    });
  });

  describe("reprovada", () => {
    it("o autor e quem enviou, sem os super admins", () => {
      expect(
        recipientsFor(
          { type: "POST_REJECTED", authorId: "editor", submitterId: "agendador", actorId: "aprovador" },
          todos,
        ).sort(),
      ).toEqual(["agendador", "editor"].sort());
    });

    it("autor que enviou a própria aparece uma vez", () => {
      expect(
        recipientsFor({ type: "POST_REJECTED", authorId: "editor", submitterId: "editor", actorId: "aprovador" }, todos),
      ).toEqual(["editor"]);
    });

    it("quem reprova não é avisado, mesmo sendo quem enviou", () => {
      expect(
        recipientsFor(
          { type: "POST_REJECTED", authorId: "editor", submitterId: "aprovador-proprio", actorId: "aprovador-proprio" },
          todos,
        ),
      ).toEqual(["editor"]);
    });

    it("autor desativado não recebe", () => {
      const semEditor = todos.filter((user) => user.id !== "editor");
      expect(
        recipientsFor({ type: "POST_REJECTED", authorId: "editor", submitterId: null, actorId: "aprovador" }, semEditor),
      ).toEqual([]);
    });
  });
});
