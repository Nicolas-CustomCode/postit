import { NextResponse, type NextRequest } from "next/server";

import { buildCsp } from "@/lib/security/csp";

/**
 * O proxy do Next 16 (antes chamado middleware).
 *
 * Por enquanto só gera o nonce e a CSP. A conferência de cookie de sessão entra
 * no Bloco B — e mesmo lá ela é só atalho de navegação: a defesa de verdade é o
 * requireSession() em cada página e Server Action (AGENTS.md, regra 5).
 */

/**
 * Um nonce novo por requisição. Reaproveitado, ele fica adivinhável e deixa de
 * separar o script nosso do script injetado — que é tudo o que ele faz.
 */
function newNonce(): string {
  return Buffer.from(crypto.randomUUID()).toString("base64");
}

export function proxy(request: NextRequest): NextResponse {
  const nonce = newNonce();
  const csp = buildCsp(nonce, process.env.NODE_ENV === "development");

  /*
   * O nonce vai nos cabeçalhos da REQUISIÇÃO, e não só da resposta: o Next lê a
   * CSP que chega, extrai o nonce e marca sozinho os próprios scripts. O x-nonce
   * é para o layout, quando precisar repassá-lo a um script que não passa pelo
   * Next.
   *
   * Isto torna toda página dinâmica: página gerada no build não tem requisição,
   * então não tem nonce. Custo aceito no docs/adr/0014.
   */
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("x-nonce", nonce);
  requestHeaders.set("Content-Security-Policy", csp);

  const response = NextResponse.next({ request: { headers: requestHeaders } });
  response.headers.set("Content-Security-Policy", csp);
  return response;
}

/**
 * Fora do proxy: arquivos estáticos, ícones e o service worker. Um service
 * worker desviado pelo proxy deixaria de ser service worker.
 */
export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|icons|serwist|manifest.webmanifest|.*\\.(?:svg|png|jpg|jpeg|gif|webp|avif|ico|woff2?)$).*)",
  ],
};
