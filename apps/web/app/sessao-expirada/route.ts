import { cookies } from "next/headers";
import { NextResponse, type NextRequest } from "next/server";
import { apiFetch } from "@/lib/api/client";
import { EXPIRED_COOKIE, SESSION_COOKIE } from "@/lib/auth/cookies";

/**
 * Apaga o cookie de uma sessão que a API já não aceita.
 *
 * ⚠️ **Ela pergunta à API ANTES de apagar.** Isto é um GET, e um GET que encerra
 * sessão pode ser disparado por qualquer `<img src="/sessao-expirada">` numa
 * página de terceiro — seria um botão de logout à disposição de qualquer um. Com
 * a conferência, um GET forjado não faz nada: a sessão válida continua válida.
 *
 * É Route Handler, e não página, porque só Server Action e Route Handler podem
 * gravar cookie — e este é o caso raro em que um GET pode ter efeito, porque o
 * efeito só acontece quando a sessão já morreu (AGENTS.md, regra 13).
 */
export async function GET(request: NextRequest): Promise<NextResponse> {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;

  if (token !== undefined) {
    try {
      await apiFetch({ method: "GET", path: "/auth/session", token });
      // A sessão vale: nada a apagar. Quem chegou aqui já pode seguir.
      return NextResponse.redirect(new URL("/", request.url));
    } catch {
      // Qualquer recusa da API confirma o motivo do desvio: seguimos e apagamos.
    }
  }

  const response = NextResponse.redirect(new URL("/entrar?expirada=1", request.url));
  response.cookies.set(SESSION_COOKIE, "", EXPIRED_COOKIE);
  return response;
}
