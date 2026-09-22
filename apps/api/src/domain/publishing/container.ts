import type { PublishFailureCause } from "@repo/shared";

/**
 * As regras do container: quantos criar, quando reaproveitar, o que fazer com cada
 * estado e como sair da dúvida depois de um `media_publish` sem resposta
 * (docs/09, "O publicador, passo a passo").
 */

export type ContainerStatusCode = "IN_PROGRESS" | "FINISHED" | "ERROR" | "EXPIRED" | "PUBLISHED";

/** *"Containers expire after 24 hours."* (docs/08) */
export const CONTAINER_TTL_MS = 24 * 60 * 60_000;

/**
 * *"Query a container's status once per minute, for no more than 5 minutes."*
 * (docs/08). Contado **pela vida do container**, e não por tentativa: um container
 * reaproveitado numa retentativa já gastou parte dos seus 5 minutos. Decidido em
 * 22/09/2026, seguindo a orientação da Meta.
 */
export const STATUS_POLL_MAX_MS = 5 * 60_000;

/**
 * Folga para reaproveitar. Um container a minutos de expirar poderia vencer entre a
 * consulta e o `media_publish`; com uma hora de sobra, isso não acontece.
 */
export const CONTAINER_REUSE_MARGIN_MS = 60 * 60_000;

/**
 * Carrossel é quantidade, não formato (ADR 0024): mais de uma mídia no Feed são os
 * containers filhos e o pai. Uma mídia, em qualquer formato, é o container único.
 */
export type ContainerPlan = { readonly kind: "SINGLE" } | { readonly kind: "CAROUSEL"; readonly items: number };

export function containerPlan(mediaCount: number): ContainerPlan {
  return mediaCount > 1 ? { kind: "CAROUSEL", items: mediaCount } : { kind: "SINGLE" };
}

/**
 * Um container gravado pode ser usado de novo?
 *
 * Reaproveitar é o que impede um carrossel de 10 que falhou no nono de recriar os
 * nove anteriores a cada tentativa, queimando a cota de 400 containers por dia
 * (docs/09). Mas só vale se ele ainda for **desta** postagem como ela está agora:
 *
 * - **mesma versão** — depois de `FALHOU → corrigir → reagendar`, um container
 *   antigo sairia com a legenda ou a imagem velha. A `versao` sobe a cada edição
 *   de usuário e o worker nunca a toca (regra 20), então ela diz se o conteúdo mudou;
 * - **mesma posição** — o filho 2 não serve de filho 3;
 * - **estado útil** e **longe de expirar**.
 */
export function isReusable(
  container: {
    readonly expiresAt: Date;
    readonly statusCode: ContainerStatusCode | null;
    readonly postVersion: number;
    readonly position: number | null;
  },
  wanted: { readonly now: Date; readonly postVersion: number; readonly position: number | null },
): boolean {
  if (container.postVersion !== wanted.postVersion) return false;
  if (container.position !== wanted.position) return false;
  if (container.expiresAt.getTime() - wanted.now.getTime() < CONTAINER_REUSE_MARGIN_MS) return false;
  return container.statusCode === null || container.statusCode === "IN_PROGRESS" || container.statusCode === "FINISHED";
}

/**
 * O que fazer depois de consultar o estado de um container.
 *
 * `ALREADY_PUBLISHED` só aparece se uma execução anterior publicou e caiu antes de
 * gravar — o publicador segue para a reconciliação, nunca para um segundo publish.
 */
export type PollDecision =
  | { readonly kind: "READY" }
  | { readonly kind: "WAIT" }
  | { readonly kind: "ALREADY_PUBLISHED" }
  | { readonly kind: "RECOVERABLE"; readonly cause: PublishFailureCause }
  | { readonly kind: "FATAL"; readonly cause: PublishFailureCause };

export function pollDecision(statusCode: ContainerStatusCode, containerCreatedAt: Date, now: Date): PollDecision {
  switch (statusCode) {
    case "FINISHED":
      return { kind: "READY" };
    case "PUBLISHED":
      return { kind: "ALREADY_PUBLISHED" };
    case "ERROR":
      return { kind: "FATAL", cause: "CONTAINER_ERROR" };
    case "EXPIRED":
      return { kind: "FATAL", cause: "CONTAINER_EXPIRED" };
    case "IN_PROGRESS":
      // Passou dos 5 minutos: desiste desta tentativa, mas o container continua
      // válido e é reaproveitado na próxima (docs/09, tabela dos recuperáveis).
      return now.getTime() - containerCreatedAt.getTime() < STATUS_POLL_MAX_MS
        ? { kind: "WAIT" }
        : { kind: "RECOVERABLE", cause: "CONTAINER_NOT_READY" };
  }
}

/**
 * Depois de um `media_publish` sem resposta, o estado do container decide
 * (docs/09, "O caso difícil").
 *
 * - `PUBLISHED` — a Meta publicou. Grava como publicada, mesmo sem saber o id da
 *   mídia (V-28): marcar `FALHOU` convidaria alguém a publicar de novo.
 * - `FINISHED` ou `IN_PROGRESS` — o container não foi consumido; tentar de novo é
 *   seguro, porque a próxima execução confere o estado antes de publicar.
 * - `ERROR` ou `EXPIRED` — não há mais como saber. `FALHOU`, dizendo com
 *   honestidade que é preciso conferir o perfil antes de republicar.
 */
export type Reconciliation = "PUBLISHED" | "RETRY" | "UNCERTAIN";

export function reconcile(statusCode: ContainerStatusCode): Reconciliation {
  if (statusCode === "PUBLISHED") return "PUBLISHED";
  if (statusCode === "FINISHED" || statusCode === "IN_PROGRESS") return "RETRY";
  return "UNCERTAIN";
}
