import type { NotificationType, PostStatus } from "./domain";

/**
 * Um aviso do sino, como a tela o recebe (RF-J01).
 *
 * O banco guarda só tipo e alvo (docs/07); o resto é lido **agora**, e é a tela
 * que monta a frase — com o horário no fuso da conta, que é conversão de borda
 * (AGENTS.md, regra 7). Alvo que não existe mais vem `null`, e a tela diz isso.
 */
export interface NotificationItem {
  /** O id da `Notificacao`. Cada pessoa marca a sua entrega por ele. */
  readonly id: string;
  readonly type: NotificationType;
  readonly createdAt: string;
  readonly readAt: string | null;
  /** A conta do aviso: a da postagem, ou a própria conta no aviso de acesso. */
  readonly account: { readonly username: string; readonly name: string | null; readonly timezone: string } | null;
  readonly post: { readonly id: string; readonly status: PostStatus; readonly scheduledAt: string | null } | null;
}

/** Quantos avisos a tela lista: os mais recentes, sem paginação por enquanto. */
export const NOTIFICATION_LIST_LIMIT = 50;
