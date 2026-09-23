import type { PostStatus } from "./domain";
import { can, type PermissionHolder } from "./permissions";

/**
 * As duas etapas da página da postagem (ADR 0026): **1 · Composição** e
 * **2 · Revisão**.
 *
 * Etapa é página em que alguém age. Agendada, Publicando, Publicada, Falhou e
 * Descartada não são etapas — são estados, mostrados num cartão da Revisão; por
 * isso, depois do agendamento, as duas aparecem concluídas.
 */
export type PostStepState = "done" | "current" | "pending" | "off";

export function postSteps(status: PostStatus): readonly [PostStepState, PostStepState] {
  switch (status) {
    case "DRAFT":
      return ["current", "pending"];
    case "IN_REVIEW":
    case "APPROVED":
      return ["done", "current"];
    case "SCHEDULED":
    case "PROCESSING":
    case "PUBLISHED":
    case "FAILED":
      return ["done", "done"];
    case "CANCELED":
      // Descartada saiu do processo: nenhuma etapa conta.
      return ["off", "off"];
  }
}

/**
 * Que página abre: a Composição só para rascunho **e** para quem edita. Quem só vê
 * cai sempre na Revisão — que mostra a postagem inteira, sem campo nenhum.
 */
export function pageStepFor(status: PostStatus, holder: PermissionHolder): "compose" | "review" {
  return status === "DRAFT" && can(holder, "POST_EDIT") ? "compose" : "review";
}
