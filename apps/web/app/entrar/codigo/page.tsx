import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import type { ReactNode } from "react";
import { safeRedirect } from "@repo/shared";
import { AuthShell } from "@/components/auth-shell";
import { CHALLENGE_COOKIE } from "@/lib/auth/cookies";
import { CodeForm } from "./code-form";

export const metadata: Metadata = { title: "Código de acesso" };

/**
 * Segundo passo do login. Sem o cookie do desafio não há o que conferir: a
 * pessoa chegou aqui direto, ou os cinco minutos passaram.
 */
export default async function CodigoPage({
  searchParams,
}: {
  readonly searchParams: Promise<{ voltar?: string }>;
}): Promise<ReactNode> {
  const destino = safeRedirect((await searchParams).voltar);
  if ((await cookies()).get(CHALLENGE_COOKIE) === undefined) redirect("/entrar");

  return (
    <AuthShell title="Código de acesso" description="Abra seu aplicativo autenticador e digite o código de 6 dígitos.">
      <CodeForm voltar={destino} />
    </AuthShell>
  );
}
