import { can, canApprovePost, type PermissionHolder } from "@repo/shared";

/**
 * Quem recebe cada aviso do sino (RF-J03).
 *
 * Calculado **no momento do envio**, com as permissões de agora: quem perde a
 * permissão amanhã não deixa de ter recebido o aviso de hoje, e quem a ganha não
 * recebe os antigos.
 *
 * Duas regras valem para todos:
 * - **Desativado nunca recebe.** Quem chama passa só os usuários ativos, e o
 *   destinatário pessoal — quem agendou, o autor — que não estiver entre eles fica
 *   de fora.
 * - **Quem causou o aviso não o recebe.** Quem envia a própria postagem para
 *   revisão já sabe que ela espera; quem reprova já sabe que reprovou.
 */

export interface Candidate extends PermissionHolder {
  readonly id: string;
}

export type Notice =
  /** Sem ator: quem falha é o worker. `null` quando ninguém agendou — a postagem veio de antes do registro. */
  | { readonly type: "PUBLISH_FAILED"; readonly scheduledById: string | null }
  | { readonly type: "ACCOUNT_ACCESS_LOST" }
  | { readonly type: "AWAITING_APPROVAL"; readonly authorId: string; readonly actorId: string }
  /**
   * Pessoal, e **sem os super admins**: é resposta a quem escreveu e a quem enviou,
   * não um alerta do sistema. `submitterId` é quem enviou para revisão por último.
   */
  | {
      readonly type: "POST_REJECTED";
      readonly authorId: string;
      readonly submitterId: string | null;
      readonly actorId: string;
    };

export function recipientsFor(notice: Notice, activeUsers: readonly Candidate[]): string[] {
  const ativos = new Set(activeUsers.map((user) => user.id));
  const pessoal = (id: string | null) => (id !== null && ativos.has(id) ? [id] : []);
  const comPermissao = (predicado: (user: Candidate) => boolean) =>
    activeUsers.filter(predicado).map((user) => user.id);

  let ids: string[];
  let ator: string | null = null;

  switch (notice.type) {
    case "PUBLISH_FAILED":
      ids = [...pessoal(notice.scheduledById), ...comPermissao((user) => can(user, "POST_SCHEDULE"))];
      break;
    case "ACCOUNT_ACCESS_LOST":
      ids = comPermissao((user) => can(user, "ACCOUNT_MANAGE"));
      break;
    case "AWAITING_APPROVAL":
      // Quem pode decidir **esta** postagem: o autor sem POST_APPROVE_OWN fica de fora.
      ids = comPermissao((user) => canApprovePost(user, notice.authorId));
      ator = notice.actorId;
      break;
    case "POST_REJECTED":
      ids = [...pessoal(notice.authorId), ...pessoal(notice.submitterId)];
      ator = notice.actorId;
      break;
  }

  // `can` já dá tudo ao super admin; sem repetir quem tem vários papéis.
  return [...new Set(ids)].filter((id) => id !== ator);
}
