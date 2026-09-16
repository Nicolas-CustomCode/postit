import type { Metadata } from "next";
import type { ReactNode } from "react";
import type { AccessLinkInfo } from "@repo/shared";
import { AuthShell } from "@/components/auth-shell";
import { DefinePasswordForm } from "@/components/define-password-form";
import { apiFetch } from "@/lib/api/client";

export const metadata: Metadata = { title: "Criar sua senha" };

/**
 * Primeiro acesso, pelo link gerado por `npm run admin:create`.
 *
 * A tela mostra de quem é o link antes de pedir a senha — é assim que a pessoa
 * percebe se recebeu o link de outra pessoa por engano.
 */
export default async function CadastroPage({
  params,
}: {
  readonly params: Promise<{ token: string }>;
}): Promise<ReactNode> {
  const { token } = await params;

  let link: AccessLinkInfo;
  try {
    link = await apiFetch<AccessLinkInfo>({
      method: "POST",
      path: "/auth/links/inspect",
      body: { token, purpose: "SIGNUP" },
    });
  } catch {
    // Inexistente, vencido, já usado ou de outra finalidade: a mesma tela. São
    // situações diferentes para quem administra e a mesma para quem abriu.
    return (
      <AuthShell title="Este link não vale mais" description="Peça um link novo a quem administra o PostIt.">
        <p className="text-sm text-muted-foreground">Links de cadastro valem 7 dias e só podem ser usados uma vez.</p>
      </AuthShell>
    );
  }

  return (
    <AuthShell title={`Bem-vindo, ${link.name}`} description={`Crie a senha da conta ${link.email}.`}>
      <DefinePasswordForm purpose="SIGNUP" token={token} />
    </AuthShell>
  );
}
