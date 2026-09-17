"use client";

import { usePathname } from "next/navigation";
import { accountFromPath, type AccountPath } from "@repo/shared";

/**
 * A conta ativa, lida do endereço da página (AGENTS.md, regra 24).
 *
 * ⚠️ **Precisa ser do cliente, e isso não é preferência.** A primeira versão
 * derivava a conta no layout do servidor, a partir de um cabeçalho que o
 * `proxy.ts` repassava por requisição. Só que, no App Router, **o layout não
 * roda de novo quando se navega entre rotas que o compartilham** — ele fica
 * preso ao valor da primeira carga completa. O sintoma: entrar por uma tela
 * geral, como `/contas`, escolher uma conta, e a barra lateral continuar
 * dizendo "Nenhuma conta" com o endereço já dentro da conta.
 *
 * `usePathname()` acompanha a navegação, que é justamente o que falta ao layout.
 *
 * A leitura em si mora em `@repo/shared`, junto com a do `proxy.ts`: as duas
 * precisam concordar sempre, e lá elas têm teste.
 */
export function useActiveAccount(): AccountPath {
  return accountFromPath(usePathname());
}
