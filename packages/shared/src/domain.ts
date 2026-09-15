/**
 * Enumerações do domínio, espelhando docs/07-modelo-dados.md.
 *
 * Nomes em inglês no código; o banco guarda os valores em português pelo @map do
 * schema (docs/adr/0023 — a tabela de tradução está lá).
 *
 * Ficam aqui, e não só no schema do Prisma, porque as telas também precisam
 * delas — e as telas nunca importam tipos do Prisma (docs/05, decisão 5).
 */

export const SOCIAL_NETWORKS = ["INSTAGRAM"] as const;
export type SocialNetwork = (typeof SOCIAL_NETWORKS)[number];

export const POST_FORMATS = ["FEED_IMAGE", "FEED_VIDEO", "CAROUSEL", "REELS", "STORIES"] as const;
export type PostFormat = (typeof POST_FORMATS)[number];

export const POST_STATUSES = [
  "DRAFT",
  "IN_REVIEW",
  "APPROVED",
  "SCHEDULED",
  "PROCESSING",
  "PUBLISHED",
  "FAILED",
  "CANCELED",
] as const;
export type PostStatus = (typeof POST_STATUSES)[number];

/**
 * O catálogo fixo de permissões (docs/adr/0015). Acrescentar uma exige código,
 * migração e atualização do ADR — de propósito: é decisão de produto.
 */
export const PERMISSIONS = ["POST_EDIT", "POST_APPROVE", "POST_APPROVE_OWN", "POST_SCHEDULE", "ACCOUNT_MANAGE"] as const;
export type Permission = (typeof PERMISSIONS)[number];

export const NOTIFICATION_TYPES = [
  "PUBLISH_FAILED",
  "AWAITING_APPROVAL",
  "TOKEN_EXPIRING",
  "ACCOUNT_ACCESS_LOST",
  "PROCESSING_STUCK",
  "ACCOUNT_LOCKED",
] as const;
export type NotificationType = (typeof NOTIFICATION_TYPES)[number];
