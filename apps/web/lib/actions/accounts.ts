"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { ApiError, apiFetch } from "../api/client";
import { SESSION_COOKIE } from "../auth/cookies";
import { requireSession } from "../auth/session";

/**
 * Começar a conexão de uma conta do Instagram (RF-A01).
 *
 * A API devolve o endereço da autorização e **o Next redireciona** — a API não
 * conhece navegador nenhum (AGENTS.md, regra 4). O `state` que amarra a volta a
 * esta pessoa é assinado lá, não aqui.
 *
 * Sempre termina em navegação, nunca em resultado: no erro, volta para a própria
 * tela de conectar com o código. É o mesmo destino que a rota de retorno usa, e
 * ter um caminho de erro só evita duas telas dizendo a mesma coisa de jeitos
 * diferentes.
 */
export async function startAccountConnectionAction(): Promise<void> {
  await requireSession();
  const token = (await cookies()).get(SESSION_COOKIE)?.value;

  let destino: string;
  try {
    const resposta = await apiFetch<{ authorizationUrl: string }>({
      method: "POST",
      path: "/accounts/connect",
      token,
    });
    destino = resposta.authorizationUrl;
  } catch (error) {
    const codigo = error instanceof ApiError ? error.code : "INTERNAL_ERROR";
    redirect(`/contas/conectar?erro=${codigo}`);
  }

  // Fora do try: o `redirect` funciona lançando, e um catch em volta dele
  // engoliria a navegação e transformaria um sucesso em "algo deu errado".
  redirect(destino);
}
