import { NextResponse, type NextRequest } from "next/server";
import { accountFromPath } from "@repo/shared";

import { cookieOptions, LAST_ACCOUNT_COOKIE, SESSION_COOKIE } from "@/lib/auth/cookies";
import { requiresSession } from "@/lib/protected-routes";
import { buildCsp } from "@/lib/security/csp";

/**
 * O proxy do Next 16 (antes chamado middleware).
 *
 * Faz duas coisas: gera o nonce da CSP e desvia para o login quem tenta abrir
 * uma tela protegida sem cookie.
 *
 * ⚠️ **Ele não protege nada.** Só olha a PRESENÇA do cookie — não fala com a
 * API, não sabe se a sessão foi revogada e não sabe quem é a pessoa. É
 * otimização de navegação: evita carregar uma tela inteira para descobrir que
 * não há sessão. A defesa é o `requireSession()` de cada página e de cada Server
 * Action (AGENTS.md, regra 5; dor registrada no `alivio-crm`, onde o middleware
 * não protegia nada).
 */

/**
 * Um nonce novo por requisição. Reaproveitado, ele fica adivinhável e deixa de
 * separar o script nosso do script injetado — que é tudo o que ele faz.
 */
function newNonce(): string {
  return Buffer.from(crypto.randomUUID()).toString("base64");
}

const UM_ANO = (): Date => new Date(Date.now() + 365 * 24 * 60 * 60 * 1000);

export function proxy(request: NextRequest): NextResponse {
  const nonce = newNonce();
  const csp = buildCsp(nonce, process.env.NODE_ENV === "development");

  const { pathname } = request.nextUrl;
  if (requiresSession(pathname) && !request.cookies.has(SESSION_COOKIE)) {
    const destino = new URL("/entrar", request.url);
    // Só o caminho, nunca a URL inteira: aceitar endereço absoluto aqui seria um
    // redirecionamento aberto — e quem lê isso do outro lado passa por
    // safeRedirect() de qualquer forma.
    destino.searchParams.set("voltar", pathname);
    return NextResponse.redirect(destino);
  }

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

  /*
   * A última conta usada, gravada aqui porque **página não pode mexer em
   * cookie** no Next — só Server Action e Route Handler. Gravar durante a
   * renderização derruba a tela com erro de servidor.
   *
   * O valor não autoriza nada: quem decide a conta ativa é o endereço, e quem
   * confere é a API. Se a conta tiver sumido, quem lê o cookie ignora o valor.
   */
  const conta = accountFromPath(pathname).username;
  if (conta !== null && request.cookies.get(LAST_ACCOUNT_COOKIE)?.value !== conta) {
    response.cookies.set(LAST_ACCOUNT_COOKIE, conta, cookieOptions(UM_ANO()));
  }

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
