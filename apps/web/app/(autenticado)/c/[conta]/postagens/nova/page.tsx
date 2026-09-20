import type { Metadata } from "next";
import { notFound } from "next/navigation";
import type { ReactNode } from "react";
import { can } from "@repo/shared";
import { PageHeader } from "@/components/nav/page-header";
import { NewPostForm } from "@/components/posts/new-post-form";
import { requireSession } from "@/lib/auth/session";

export const metadata: Metadata = { title: "Nova postagem" };

/**
 * Começar uma postagem na conta ativa (RF-C01).
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

  return (
    <main className="mx-auto flex w-full max-w-2xl flex-1 flex-col gap-6 px-4 pb-8 md:px-10 md:py-7">
      <PageHeader
        trail={["Nesta conta", "Postagens", "Nova"]}
        title="Nova postagem"
        description="Ela nasce como rascunho. Nada vai para o Instagram agora."
      />
      <NewPostForm username={decodeURIComponent(conta)} />
    </main>
  );
}
