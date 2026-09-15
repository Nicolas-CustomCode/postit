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
 * Push entra na Fase 1, junto com as notificações.
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
