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
