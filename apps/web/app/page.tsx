import { redirect } from "next/navigation";
import type { ReactNode } from "react";
import { accountToOpen } from "@/lib/accounts/active-account";
import { listAccounts } from "@/lib/data/accounts";
import { getSession } from "@/lib/auth/session";

/**
 * A raiz não desenha nada: decide para onde a pessoa vai.
 *
 * É o endereço gravado no aparelho quando o app é instalado (`start_url` do
 * manifesto), então precisa servir a quem está logado e a quem não está. Quem
 * entra cai na última conta usada — o cookie serve só para isso.
 */
export default async function HomePage(): Promise<ReactNode> {
  if ((await getSession()) === null) redirect("/entrar");

  const conta = await accountToOpen(await listAccounts());
  redirect(conta === null ? "/contas" : `/c/${conta.username}/calendario`);
}
