import { redirect } from "next/navigation";
import type { ReactNode } from "react";
import { listAccounts } from "@/lib/data/accounts";
import { requireSession } from "@/lib/auth/session";

/**
 * As telas de uma conta (`/c/<conta>/…`).
 *
 * A conta vem do endereço, e é conferida aqui: endereço de conta que não existe
 * — porque o @ mudou no Instagram, porque a conta foi removida, ou porque o link
 * veio errado — leva de volta à lista, em vez de mostrar tela vazia.
 *
 * A última conta usada é gravada pelo `proxy.ts`, não aqui: página não pode
 * mexer em cookie no Next.
 */
export default async function ContaLayout({
  children,
  params,
}: {
  readonly children: ReactNode;
  readonly params: Promise<{ conta: string }>;
}): Promise<ReactNode> {
  await requireSession();

  const { conta } = await params;
  const username = decodeURIComponent(conta);
  const accounts = await listAccounts();

  if (accounts.length === 0) redirect("/contas");
  if (!accounts.some((account) => account.username === username)) redirect("/contas?desconhecida=1");

  return children;
}
