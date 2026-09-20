import { can, type PermissionHolder } from "@repo/shared";

/**
 * Quem pode aprovar o quê (RF-E02, RF-I04; ADR 0015).
 *
 * A regra tem duas partes, e só uma cabe num decorator:
 *
 * - **aprovar** exige `POSTAGEM_APROVAR` — estático, é a política da rota, e o
 *   teste de política consegue auditá-la;
 * - **aprovar a própria postagem** exige, além disso, `POSTAGEM_APROVAR_PROPRIA`.
 *
 * ⚠️ **A segunda parte não pode ir para o `@RequirePermission`.** O guard usa
 * `every()` — declarar as duas exigiria `POSTAGEM_APROVAR_PROPRIA` também de
 * quem aprova postagem alheia, que é o contrário do que a regra diz. E o guard
 * roda **antes** de a postagem ser carregada: ele não tem como saber quem é o
 * autor. É o que o AGENTS.md quer dizer com "autoaprovação é regra do serviço
 * de aprovação".
 *
 * Pura de propósito: a matriz inteira — tem ou não a permissão × é ou não o
 * autor × super admin — se testa sem subir Nest nem banco.
 */
export function selfApprovalRefused(approver: PermissionHolder & { id: string }, authorId: string): boolean {
  if (approver.id !== authorId) return false;
  return !can(approver, "POST_APPROVE_OWN");
}
