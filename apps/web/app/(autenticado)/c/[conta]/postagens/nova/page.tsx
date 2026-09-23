import type { Metadata } from "next";
import { notFound } from "next/navigation";
import type { ReactNode } from "react";
import { can } from "@repo/shared";
import { PageHeader } from "@/components/nav/page-header";
import { ComposeForm } from "@/components/posts/compose-form";
import { PostStepper } from "@/components/posts/post-stepper";
import { requireSession } from "@/lib/auth/session";
import { listMedia } from "@/lib/data/media";
import { accountFor } from "@/lib/data/posts";

export const metadata: Metadata = { title: "Nova postagem" };

/**
 * Nova postagem na conta ativa (RF-C01; artboard `ComposicaoDesktop`).
 *
 * **É a mesma tela de compor**, sem passo intermediário: o artboard chama esta
 * tela de "Nova postagem" e já mostra formato, mídia, legenda e a prévia. A
 * postagem nasce no banco no primeiro salvamento — não ao abrir —, senão cada
 * visita a este endereço deixaria um rascunho vazio para trás.
 *
 * Esconder não é proteger: a API recusa de novo (regra 17). Aqui é para não
 * mostrar um caminho que terminaria em 403.
 */
export default async function NovaPostagemPage({
  params,
}: {
  readonly params: Promise<{ conta: string }>;
}): Promise<ReactNode> {
  const { user } = await requireSession();
  if (!can(user, "POST_EDIT")) notFound();

  const { conta } = await params;
  const username = decodeURIComponent(conta);
  const [account, media] = await Promise.all([accountFor(username), listMedia()]);

  return (
    <main className="mx-auto flex w-full max-w-6xl flex-1 flex-col gap-5 px-4 pb-8 md:px-10 md:py-7">
      <PageHeader trail={[`@${username}`, "Postagens", "Nova postagem"]} title="Nova postagem" />
      {/* A etapa 1, como na postagem salva (ADR 0026): nasce rascunho. */}
      <PostStepper post={null} timeZone={account.timezone} />
      <ComposeForm username={username} account={account} timeZone={account.timezone} media={media} post={null} />
    </main>
  );
}
