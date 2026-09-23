/**
 * A mesma pergunta, feita nos dois lados: "esta pessoa pode?".
 *
 * A tela usa para esconder botão; a API usa para decidir. São usos diferentes da
 * mesma função, e é isso que impede a tela de mostrar um botão que a API vai
 * recusar. **Quem decide continua sendo a API** (AGENTS.md, regra 17): esconder
 * botão não é proteção.
 */
import type { Permission } from "./domain";

export interface PermissionHolder {
  readonly superAdmin: boolean;
  readonly permissions: readonly Permission[];
}

/** Super admin tem todas, sem nenhuma linha em PermissaoUsuario (ADR 0015). */
export function can(holder: PermissionHolder, permission: Permission): boolean {
  return holder.superAdmin || holder.permissions.includes(permission);
}

/**
 * Autoaprovação (RF-E02, RF-I04; ADR 0015): quem é o autor precisa, além de
 * `POSTAGEM_APROVAR`, de `POSTAGEM_APROVAR_PROPRIA`. Vale para reprovar também —
 * o ADR 0015 dá `POSTAGEM_APROVAR` para postagens **de outros**.
 *
 * ⚠️ **Não cabe no `@RequirePermission`.** O guard usa `every()` — declarar as duas
 * exigiria `POSTAGEM_APROVAR_PROPRIA` de quem aprova postagem alheia, que é o
 * contrário da regra. E o guard roda antes de a postagem ser carregada: não sabe
 * quem é o autor. É regra do serviço, e a tela usa a mesma função para esconder o
 * botão.
 */
export function selfApprovalRefused(approver: PermissionHolder & { readonly id: string }, authorId: string): boolean {
  if (approver.id !== authorId) return false;
  return !can(approver, "POST_APPROVE_OWN");
}

/** Esta pessoa pode aprovar ou reprovar esta postagem? A tela pergunta; a API decide. */
export function canApprovePost(holder: PermissionHolder & { readonly id: string }, authorId: string): boolean {
  return can(holder, "POST_APPROVE") && !selfApprovalRefused(holder, authorId);
}
