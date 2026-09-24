import type { PushSubscriptionInput } from "@repo/shared";

/**
 * O que este aparelho sabe fazer, para o Perfil dizer o estado certo antes de
 * oferecer o botão (docs/04, 11.1; docs/13, "Instalação e notificações").
 *
 * Só no navegador: todas as funções leem `window` e `navigator`, e quem chama é
 * componente de cliente, depois de montar.
 */

/** Rodando como app instalado, fora da aba do navegador. */
export function isStandalone(): boolean {
  if (window.matchMedia("(display-mode: standalone)").matches) return true;
  // O Safari do iPhone não respeita display-mode antigo; ele tem o próprio sinal.
  return (navigator as Navigator & { standalone?: boolean }).standalone === true;
}

/** iPhone ou iPad — inclusive o iPad que se apresenta como Mac. */
export function isIos(): boolean {
  const ua = navigator.userAgent;
  return /iPhone|iPad|iPod/.test(ua) || (ua.includes("Macintosh") && navigator.maxTouchPoints > 1);
}

export function isAndroid(): boolean {
  return /Android/.test(navigator.userAgent);
}

/** O navegador tem tudo o que o push precisa: service worker, PushManager e notificações. */
export function pushSupported(): boolean {
  return "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;
}

/** A inscrição do navegador no formato que a API aceita. `null` se faltar alguma chave. */
export function subscriptionInput(subscription: PushSubscription): PushSubscriptionInput | null {
  const json = subscription.toJSON();
  const p256dh = json.keys?.["p256dh"];
  const auth = json.keys?.["auth"];
  if (json.endpoint === undefined || p256dh === undefined || auth === undefined) return null;
  return { endpoint: json.endpoint, keys: { p256dh, auth } };
}

/** A chave pública VAPID, de base64url para o formato que o `subscribe` pede. */
export function vapidKeyBytes(base64url: string): Uint8Array<ArrayBuffer> {
  const base64 = (base64url + "=".repeat((4 - (base64url.length % 4)) % 4)).replace(/-/g, "+").replace(/_/g, "/");
  const binario = atob(base64);
  const bytes = new Uint8Array(new ArrayBuffer(binario.length));
  for (let i = 0; i < binario.length; i += 1) bytes[i] = binario.charCodeAt(i);
  return bytes;
}
