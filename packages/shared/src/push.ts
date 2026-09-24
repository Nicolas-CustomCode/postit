import { z } from "zod";
import type { NotificationType } from "./domain";

/**
 * O push das notificações (RF-J02, RF-J04; ADR 0017).
 *
 * ⚠️ **O push não carrega dado sensível** (AGENTS.md, regra 22). O que vai ao
 * aparelho é exatamente `{ title, url }`: um título genérico, fixo por tipo, e o
 * link do próprio aviso — sem nome de conta, legenda, e-mail nem motivo de erro. O
 * detalhe aparece depois de abrir o sistema, logado. Por isso o título não tem
 * espaço para nada variável, e o teste confere.
 */

/** Os tipos que o sino gera hoje, e que cada pessoa pode ligar ou desligar no push. */
export const PUSH_NOTIFICATION_TYPES = [
  "PUBLISH_FAILED",
  "ACCOUNT_ACCESS_LOST",
  "AWAITING_APPROVAL",
  "POST_REJECTED",
] as const satisfies readonly NotificationType[];
export type PushNotificationType = (typeof PUSH_NOTIFICATION_TYPES)[number];

const PUSH_TITLES: Record<PushNotificationType, string> = {
  PUBLISH_FAILED: "Uma publicação falhou",
  ACCOUNT_ACCESS_LOST: "Uma conta perdeu o acesso",
  AWAITING_APPROVAL: "Há uma postagem aguardando aprovação",
  POST_REJECTED: "Uma postagem foi reprovada",
};

/** O rótulo de cada tipo nas preferências do Perfil. */
export const PUSH_TYPE_LABELS: Record<PushNotificationType, string> = {
  PUBLISH_FAILED: "Publicação que falhou",
  ACCOUNT_ACCESS_LOST: "Conta que perdeu o acesso",
  AWAITING_APPROVAL: "Postagem aguardando aprovação",
  POST_REJECTED: "Postagem reprovada",
};

export interface PushPayload {
  readonly title: string;
  /** Caminho relativo do próprio PostIt. O service worker recusa qualquer outro. */
  readonly url: string;
}

export function isPushNotificationType(type: string): type is PushNotificationType {
  return (PUSH_NOTIFICATION_TYPES as readonly string[]).includes(type);
}

/** O que vai ao aparelho: o título do tipo e o link do aviso, que marca como lido ao abrir. */
export function pushPayloadFor(type: PushNotificationType, notificationId: string): PushPayload {
  return { title: PUSH_TITLES[type], url: `/notificacoes/${notificationId}` };
}

/** O push de teste, pedido no Perfil: prova o caminho inteiro até o aparelho. */
export const PUSH_TEST_PAYLOAD: PushPayload = { title: "Notificações ativas neste aparelho", url: "/perfil" };

/*
 * As chaves que o navegador entrega em base64url: `p256dh` é um ponto da curva
 * P-256 (65 bytes, 87 caracteres), `auth` são 16 bytes (22 caracteres). O teto
 * folgado recusa lixo sem depender do tamanho exato.
 */
const base64url = (max: number) => z.string().min(1).max(max).regex(/^[A-Za-z0-9_-]+={0,2}$/);

export const pushSubscriptionSchema = z.object({
  // O endereço do serviço de push do navegador — sempre https.
  endpoint: z.string().url().max(2048).startsWith("https://"),
  keys: z.object({ p256dh: base64url(200), auth: base64url(64) }),
});
export type PushSubscriptionInput = z.infer<typeof pushSubscriptionSchema>;

export const pushEndpointSchema = z.object({ endpoint: z.string().url().max(2048) });
export type PushEndpointInput = z.infer<typeof pushEndpointSchema>;

export const pushPreferenceSchema = z.object({
  type: z.enum(PUSH_NOTIFICATION_TYPES),
  push: z.boolean(),
});
export type PushPreferenceInput = z.infer<typeof pushPreferenceSchema>;

/** Uma preferência, como o Perfil a recebe. Sem linha no banco, vale ligado. */
export interface PushPreference {
  readonly type: PushNotificationType;
  readonly push: boolean;
}
