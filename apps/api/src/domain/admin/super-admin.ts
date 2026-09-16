/**
 * Invariante I-10: nunca zero super admin ativo (docs/05, ADR 0015).
 *
 * Um sistema sem super admin não tem como recuperar a si mesmo pela tela — só
 * por comando no servidor. Por isso a checagem é regra de domínio, e quem chama
 * é obrigado a rodá-la **dentro da transação**, com a contagem lida ali: um
 * `if` antes de abrir a transação deixa passar duas desativações simultâneas.
 */

export type SuperAdminRefusal = "SELF" | "LAST_SUPER_ADMIN" | null;

export function refuseRemoval(input: {
  readonly actorId: string;
  readonly targetId: string;
  readonly targetIsSuperAdmin: boolean;
  /** Super admins ativos AGORA, contados na mesma transação. */
  readonly activeSuperAdmins: number;
}): SuperAdminRefusal {
  // Ninguém se desativa nem se rebaixa: seria o jeito mais fácil de ficar de
  // fora do próprio sistema, e por engano.
  if (input.actorId === input.targetId) return "SELF";
  if (input.targetIsSuperAdmin && input.activeSuperAdmins <= 1) return "LAST_SUPER_ADMIN";
  return null;
}
