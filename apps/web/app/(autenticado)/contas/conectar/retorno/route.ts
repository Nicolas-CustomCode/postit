import { cookies } from "next/headers";
import { NextResponse, type NextRequest } from "next/server";
import { ApiError, apiFetch } from "@/lib/api/client";
import { SESSION_COOKIE } from "@/lib/auth/cookies";
import { readWebEnv } from "@/lib/env";
import { requireSession } from "@/lib/auth/session";

/**
 * A volta da autorização do Instagram (docs/08, "Quem faz o quê").
 *
 * ⚠️ **Por que um Route Handler GET, com a regra 13 dizendo que toda escrita no
 * Next é Server Action:** quem navega para cá é a Meta, redirecionando o
 * navegador. Não existe formulário para uma Server Action escutar. A regra 13
 * proíbe *route handler POST* e exige que um GET não cause efeito perigoso —
 * e este não causa nada sozinho: ele só repassa `code` e `state` para a API, que
 * confere a assinatura do `state` contra o usuário da sessão e decide.
 *
 * O Next **nunca vê** o segredo do app nem o token: a troca inteira acontece na
 * API (regra 4).
 *
 * `requireSession()` aqui não é decoração: sem ele, um retorno recebido sem
 * sessão viraria uma chamada à API sem token e um erro sem sentido na tela
 * (regra 5).
 */
export async function GET(request: NextRequest): Promise<NextResponse> {
  await requireSession();

  const parametros = request.nextUrl.searchParams;
  const code = parametros.get("code");
  const state = parametros.get("state");

  // A pessoa recusou a autorização na tela da Meta, ou a Meta devolveu erro.
  // Não é falha nossa, e não merece tela de erro: volta para o começo.
  if (code === null || state === null) return paraConectar("CONNECTION_INVALID");

  const token = (await cookies()).get(SESSION_COOKIE)?.value;

  try {
    const { username } = await apiFetch<{ username: string }>({
      method: "POST",
      path: "/accounts/connect/finish",
      body: { code, state },
      token,
    });

    // Direto para a conta recém-conectada: é o que a pessoa veio fazer.
    return paraDentro(`/c/${encodeURIComponent(username)}/calendario`);
  } catch (error) {
    const codigo = error instanceof ApiError ? error.code : "INTERNAL_ERROR";
    return paraConectar(codigo);
  }
}

/** Volta para a tela de conectar com o código do erro, que ela traduz. */
function paraConectar(code: string): NextResponse {
  return paraDentro(`/contas/conectar?erro=${encodeURIComponent(code)}`);
}

/**
 * Redireciona para dentro do PostIt usando o **endereço configurado**, e não a
 * origem da requisição.
 *
 * ⚠️ `request.nextUrl.origin` devolve `localhost` quando o app é servido pelo
 * túnel: o Next enxerga a conexão que chega do cloudflared, não o endereço
 * público pelo qual a pessoa entrou. O resultado é o navegador sair do túnel no
 * meio do fluxo — e perder a sessão, porque o cookie pertence ao outro endereço.
 *
 * `APP_URL` é a fonte certa: ela é validada no boot, é o mesmo valor que decide
 * o prefixo do cookie de sessão, e o script do túnel a mantém em dia.
 */
function paraDentro(caminho: string): NextResponse {
  return NextResponse.redirect(new URL(caminho, readWebEnv().APP_URL));
}
