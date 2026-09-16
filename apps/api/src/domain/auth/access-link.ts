/**
 * Links de cadastro e de redefinição (ADR 0013, seção 6).
 *
 * O sistema não envia e-mail: o link é gerado no servidor e entregue por canal
 * de confiança. Guardado só como hash, uso único.
 */
import type { AccessLinkPurpose } from "@repo/shared";

export interface AccessLinkTtl {
  readonly signupDays: number;
  readonly passwordResetHours: number;
}

export function linkExpiry(now: Date, purpose: AccessLinkPurpose, ttl: AccessLinkTtl): Date {
  const hours = purpose === "SIGNUP" ? ttl.signupDays * 24 : ttl.passwordResetHours;
  return new Date(now.getTime() + hours * 60 * 60 * 1000);
}

export interface StoredLink {
  readonly purpose: AccessLinkPurpose;
  readonly expiresAt: Date;
  readonly usedAt: Date | null;
}

/**
 * Inexistente, vencido, já usado e de outra finalidade são situações diferentes
 * para quem administra e **a mesma** para quem abriu um endereço que não vale
 * mais. Por isso a resposta é booleana: quem chama devolve um erro só.
 */
export function isLinkUsable(link: StoredLink, expected: AccessLinkPurpose, now: Date): boolean {
  if (link.purpose !== expected) return false;
  if (link.usedAt !== null) return false;
  return link.expiresAt.getTime() > now.getTime();
}
