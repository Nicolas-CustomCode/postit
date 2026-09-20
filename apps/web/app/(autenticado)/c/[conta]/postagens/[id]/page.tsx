import type { Metadata } from "next";
import { notFound } from "next/navigation";
import type { ReactNode } from "react";
import { can } from "@repo/shared";
import { PageHeader } from "@/components/nav/page-header";
import { ComposeForm } from "@/components/posts/compose-form";
import { requireSession } from "@/lib/auth/session";
import { getPost } from "@/lib/data/posts";

export const metadata: Metadata = { title: "Compor" };

/**
 * Editar uma postagem (docs/13, "Compor").
 *
 * Esconder não é proteger: a API recusa de novo (regra 17). Aqui é para não
 * mostrar um caminho que terminaria em 403.
 */
export default async function ComporPage({
  params,
}: {
  readonly params: Promise<{ conta: string; id: string }>;
}): Promise<ReactNode> {
  const { user } = await requireSession();
  if (!can(user, "POST_EDIT")) notFound();

  const { conta, id } = await params;
  const username = decodeURIComponent(conta);
  const post = await getPost(username, id);

  return (
    <main className="mx-auto flex w-full max-w-2xl flex-1 flex-col gap-6 px-4 pb-8 md:px-10 md:py-7">
      <PageHeader trail={["Nesta conta", "Postagens", "Compor"]} title="Compor" />
      <ComposeForm username={username} post={post} />
    </main>
  );
}
