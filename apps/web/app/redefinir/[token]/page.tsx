import type { Metadata } from "next";
import type { ReactNode } from "react";
import type { AccessLinkInfo } from "@repo/shared";
import { AuthShell } from "@/components/auth-shell";
import { DefinePasswordForm } from "@/components/define-password-form";
import { apiFetch } from "@/lib/api/client";

export const metadata: Metadata = { title: "Redefinir a senha" };

/**
 * Redefinição, pelo link gerado por `npm run admin:reset-password`.
 *
 * Salvar aqui **derruba todas as sessões** daquela pessoa: se a senha vazou,
 * quem entrou com ela sai. A verificação em duas etapas continua como estava.
 */
export default async function RedefinirPage({
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
      body: { token, purpose: "PASSWORD_RESET" },
    });
  } catch {
    return (
      <AuthShell title="Este link não vale mais" description="Peça um link novo a quem administra o PostIt.">
        <p className="text-sm text-muted-foreground">
          Links de redefinição valem 24 horas e só podem ser usados uma vez.
        </p>
      </AuthShell>
    );
  }

  return (
    <AuthShell title="Redefinir a senha" description={`Conta ${link.email}. As outras sessões serão encerradas.`}>
      <DefinePasswordForm purpose="PASSWORD_RESET" token={token} />
    </AuthShell>
  );
}
