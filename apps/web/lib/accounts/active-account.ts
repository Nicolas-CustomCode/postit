import "server-only";
import { cookies } from "next/headers";
import type { AccountSummary } from "@repo/shared";
import { LAST_ACCOUNT_COOKIE } from "../auth/cookies";

/**
 * Em que conta o sistema abre.
 *
 * ⚠️ Quem **grava** o cookie é o `proxy.ts`, e não uma página: o Next só deixa
 * mexer em cookie em Server Action ou Route Handler, e gravar durante a
 * renderização derruba a tela inteira com erro de servidor. Aqui só se lê.
 *
 * O cookie não autoriza nada. A conta em que a pessoa está trabalhando vem do
 * endereço, sempre (AGENTS.md, regra 24), e a API confere a cada chamada.
 */
export async function accountToOpen(accounts: readonly AccountSummary[]): Promise<AccountSummary | null> {
  if (accounts.length === 0) return null;

  const lembrada = (await cookies()).get(LAST_ACCOUNT_COOKIE)?.value;
  // Conta que saiu, ou @ que mudou no Instagram: cai na primeira da lista.
  return accounts.find((conta) => conta.username === lembrada) ?? accounts[0] ?? null;
}
