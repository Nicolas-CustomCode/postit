import type { Metadata } from "next";
import { redirect } from "next/navigation";
import type { ReactNode } from "react";
import { safeRedirect } from "@repo/shared";
import { AuthShell } from "@/components/auth-shell";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { getSession } from "@/lib/auth/session";
import { LoginForm } from "./login-form";

export const metadata: Metadata = { title: "Entrar" };

/**
 * A tela de entrada.
 *
 * Quem já tem sessão válida não fica aqui: vai para o destino pedido. Quem tem
 * cookie sem sessão continua vendo o formulário — apagar o cookie é papel de
 * `/sessao-expirada`, que confere antes.
 */
export default async function EntrarPage({
  searchParams,
}: {
  readonly searchParams: Promise<{ voltar?: string; definida?: string; expirada?: string }>;
}): Promise<ReactNode> {
  const { voltar, definida, expirada } = await searchParams;
  // Todo destino vindo da URL passa por aqui (AGENTS.md, regra 14).
  const destino = safeRedirect(voltar);

  if ((await getSession()) !== null) redirect(destino);

  return (
    <AuthShell title="Entrar" description="Depois da senha, o PostIt pede o código do seu aplicativo autenticador.">
      {definida === "1" ? (
        <Alert className="mb-4">
          <AlertDescription>Senha definida. Agora entre com ela.</AlertDescription>
        </Alert>
      ) : null}
      {expirada === "1" ? (
        <Alert className="mb-4">
          <AlertDescription>Sua sessão expirou. Entre de novo.</AlertDescription>
        </Alert>
      ) : null}
      <LoginForm voltar={destino} />
    </AuthShell>
  );
}
