"use client";

import { useEffect, type ReactNode } from "react";
import { savePushSubscriptionAction } from "@/lib/actions/notifications";
import { pushSupported, subscriptionInput } from "@/lib/pwa/device";

/**
 * Reata o push deste aparelho à sessão atual (ADR 0017, acréscimo de 24/09/2026).
 *
 * A inscrição morre com a sessão: saiu do PostIt, o worker a apaga no próximo
 * aviso. Ao entrar de novo, o navegador ainda guarda a inscrição dele e a
 * permissão já dada — basta mandá-la outra vez, agora com a sessão nova. É o que
 * faz o push "voltar sozinho" sem a pessoa passar pelo Perfil.
 *
 * Uma vez por carga completa, em silêncio e idempotente. Quem desativou no Perfil
 * cancelou a inscrição no navegador, e aqui não há nada a reatar. Não pede
 * permissão nunca: isso só no botão do Perfil (RF-J02).
 */
export function PushResync(): ReactNode {
  useEffect(() => {
    if (!pushSupported() || Notification.permission !== "granted") return;

    void (async () => {
      const registro = await navigator.serviceWorker.getRegistration();
      const inscricao = await registro?.pushManager.getSubscription();
      const dados = inscricao ? subscriptionInput(inscricao) : null;
      if (dados !== null) await savePushSubscriptionAction(dados);
    })().catch(() => undefined);
  }, []);

  return null;
}
