import type { Metadata } from "next";
import type { ReactNode } from "react";
import { safeRedirect } from "@repo/shared";
import { AuthShell } from "@/components/auth-shell";
import { SetupForm } from "./setup-form";

export const metadata: Metadata = { title: "Cadastrar as duas etapas" };

/**
 * Primeiro acesso: a pessoa já acertou a senha e precisa cadastrar o aplicativo
 * autenticador antes de ter sessão.
 *
 * ⚠️ A página **não busca nada** e não confere o cookie do desafio. O Next
 * re-renderiza a página atual depois de cada Server Action, e o desafio é
 * consumido justamente por uma delas: uma busca aqui encontraria o desafio já
 * usado e desviaria a pessoa da tela — levando embora os códigos de recuperação,
 * que só aparecem uma vez. Quem pede o QR é o formulário, por ação; sem desafio
 * válido, ele mostra o aviso para entrar de novo.
 */
export default async function CadastroDuasEtapasPage({
  searchParams,
}: {
  readonly searchParams: Promise<{ voltar?: string }>;
}): Promise<ReactNode> {
  const destino = safeRedirect((await searchParams).voltar);

  return (
    <AuthShell
      title="Cadastre as duas etapas"
      description="É obrigatório para todos: sem o código, uma senha vazada não dá acesso."
    >
      <SetupForm voltar={destino} />
    </AuthShell>
  );
}
