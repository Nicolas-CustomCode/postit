/// <reference lib="esnext" />
/// <reference lib="webworker" />

import { defaultCache } from "@serwist/turbopack/worker";
import { NetworkOnly, Serwist, type PrecacheEntry, type SerwistGlobalConfig } from "serwist";

/**
 * O service worker (docs/adr/0017). Fica entre o app e a rede: quando o app pede
 * algo, ele responde primeiro — da cópia guardada ou deixando o pedido seguir.
 *
 * Não é compilado pelo Next: o withSerwist o passa pelo esbuild e injeta
 * __SW_MANIFEST com os arquivos a guardar. Aqui não existe `window`, só `self`.
 *
 * Também recebe o push (RF-J02) e abre o aviso quando a pessoa toca — ver os dois
 * tratadores no fim do arquivo.
 */
declare global {
  interface WorkerGlobalScope extends SerwistGlobalConfig {
    __SW_MANIFEST: (PrecacheEntry | string)[] | undefined;
  }
}

declare const self: ServiceWorkerGlobalScope;

/**
 * O que PODE ir para o cache: só os arquivos do próprio build, que têm o hash no
 * nome e não carregam dado de ninguém.
 *
 * É uma lista do que é permitido, e não do que é proibido, porque quase toda
 * tela do PostIt é autenticada (AGENTS.md, regra 22). Com lista de proibidos,
 * uma rota nova esquecida ficaria gravada no aparelho e sobreviveria ao logout —
 * sem nenhum sintoma. O nossobuncker registrou exatamente esse problema.
 */
function isBuildAsset(url: URL, sameOrigin: boolean): boolean {
  return sameOrigin && url.pathname.startsWith("/_next/static/");
}

const serwist = new Serwist({
  precacheEntries: self.__SW_MANIFEST,
  // A versão nova assume sem esperar as abas fecharem, e vale já nas abertas.
  // Sem isso, alguém fica preso numa versão antiga sem perceber.
  skipWaiting: true,
  clientsClaim: true,
  navigationPreload: true,
  runtimeCaching: [
    {
      // Páginas, dados das telas (RSC), Server Actions, ícones e as mídias do
      // MinIO: sempre da rede, nunca guardados. A primeira regra que casa vence.
      matcher: ({ url, sameOrigin }: { url: URL; sameOrigin: boolean }) => !isBuildAsset(url, sameOrigin),
      handler: new NetworkOnly(),
    },
    ...defaultCache,
  ],
  fallbacks: {
    entries: [
      {
        url: "/~offline",
        // Só navegação: uma imagem que falha não deve virar a página "sem conexão".
        matcher: ({ request }) => request.destination === "document",
      },
    ],
  },
});

serwist.addEventListeners();

/**
 * O push chega como `{ title, url }` e mais nada (AGENTS.md, regra 22): o que a
 * tela bloqueada mostra é só o título genérico. Sem corpo de propósito — o
 * detalhe aparece depois de abrir o PostIt, logado.
 *
 * Payload ilegível não some: vira um aviso genérico que leva ao sino, porque um
 * push que chegou é sinal de que algo aconteceu.
 */
self.addEventListener("push", (event) => {
  let title = "PostIt";
  let url = "/notificacoes";
  try {
    const data: unknown = event.data?.json();
    if (typeof data === "object" && data !== null) {
      const { title: t, url: u } = data as { title?: unknown; url?: unknown };
      if (typeof t === "string" && t.length > 0) title = t;
      url = safePath(u);
    }
  } catch {
    // Mantém o aviso genérico.
  }

  event.waitUntil(
    self.registration.showNotification(title, {
      icon: "/icons/192",
      // O mesmo aviso chegando de novo substitui o anterior em vez de empilhar.
      tag: url,
      data: { url },
    }),
  );
});

/**
 * Tocar abre o aviso: foca uma janela do PostIt que já esteja aberta, ou abre uma
 * nova. O destino passa pelo mesmo filtro do push — nada fora do próprio PostIt.
 */
self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = safePath((event.notification.data as { url?: unknown } | null)?.url);

  event.waitUntil(
    (async () => {
      const janelas = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
      const aberta = janelas.find((janela) => new URL(janela.url).origin === self.location.origin);
      if (aberta !== undefined) {
        await aberta.focus();
        await aberta.navigate(url);
        return;
      }
      await self.clients.openWindow(url);
    })(),
  );
});

/**
 * Só caminho do próprio PostIt: começa com `/` e não com `//` (que o navegador lê
 * como outro domínio). Qualquer outra coisa leva ao sino — um payload adulterado
 * não pode transformar o toque num redirecionamento para fora.
 */
function safePath(value: unknown): string {
  if (typeof value !== "string" || !value.startsWith("/") || value.startsWith("//") || value.includes("\\")) {
    return "/notificacoes";
  }
  return value;
}
