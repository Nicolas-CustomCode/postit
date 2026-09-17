import { ChevronLeft } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
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
    <AuthShell
      step="Etapa 2 de 2"
      title="Verificação em duas etapas"
      description="Abra o aplicativo autenticador e digite o código de 6 dígitos do PostIt."
      footer={
        <>
          <Link href="/entrar" className="flex min-h-11 items-center gap-2 text-[15px] font-semibold text-foreground">
            <ChevronLeft className="size-4.5" strokeWidth={2} aria-hidden />
            Voltar para e-mail e senha
          </Link>
          <p className="mt-2">
            Sem o celular e sem os códigos de recuperação? Peça a um super admin para redefinir sua verificação.
          </p>
        </>
      }
    >
      <CodeForm voltar={destino} />
    </AuthShell>
  );
}
