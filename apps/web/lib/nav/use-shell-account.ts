"use client";

import { useState } from "react";
import { useActiveAccount } from "@/lib/nav/use-active-account";

/**
 * A conta que a **casca** mostra — que não é a mesma coisa que a conta ativa.
 *
 * Nas telas da conta as duas coincidem. Nas telas gerais — Acervo, Perfil,
 * Contas — o endereço não tem conta, e sem isto a barra lateral dizia "Nenhuma
 * conta" e apagava Calendário, Postagens e Métricas com o título "Conecte uma
 * conta primeiro" — mentira, quando há conta conectada. Quem estava no Acervo
 * precisava escolher a conta de novo para voltar a qualquer tela dela.
 *
 * ⚠️ **Isto não afrouxa a regra 24 do AGENTS.md.** Quem **age** continua sendo o
 * endereço: `useActiveAccount()` é a única fonte da conta que recebe ação, e
 * toda chamada à API leva a conta do endereço. O que esta função responde é
 * outra pergunta — "para qual conta os atalhos da casca apontam?" —, e a
 * resposta nunca vira alvo de escrita nenhuma.
 *
 * ⚠️ **O valor do servidor sozinho não serve, e é o defeito que isto conserta.**
 * `rememberedAccount` nasce no layout autenticado, e no App Router **o layout
 * não roda de novo** ao navegar entre rotas que o compartilham (regra 25): ele
 * congela na primeira carga completa. Entrar em `/c/aurora/…`, trocar para
 * `/c/padaria/…` e ir ao Acervo deixava a casca apontando para `aurora` — a
 * conta da primeira carga, não a última usada. Por isso o endereço atual tem
 * precedência e o valor do servidor é só a semente.
 *
 * O ajuste de estado **durante a renderização** é o padrão do React para "a
 * prop mudou, o estado derivado precisa acompanhar": ele re-renderiza na hora,
 * sem pintar o valor velho na tela. Um `useEffect` aqui mostraria a conta
 * anterior por um quadro.
 */
export function useShellAccount(rememberedAccount: string | null): string | null {
  const { username } = useActiveAccount();
  const [ultima, setUltima] = useState(rememberedAccount);

  if (username !== null && username !== ultima) setUltima(username);

  return username ?? ultima;
}
