import type { Metadata } from "next";
import { notFound } from "next/navigation";
import type { ReactNode } from "react";
import { can } from "@repo/shared";
import { LocalDate } from "@/components/local-date";
import { PageHeader } from "@/components/nav/page-header";
import { ComposeForm } from "@/components/posts/compose-form";
import { PostStatusBadge } from "@/components/posts/post-status-badge";
import { requireSession } from "@/lib/auth/session";
import { accountFor, getPost } from "@/lib/data/posts";

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
  const [post, account] = await Promise.all([getPost(username, id), accountFor(username)]);

  return (
    <main className="mx-auto flex w-full max-w-6xl flex-1 flex-col gap-6 px-4 pb-8 md:px-10 md:py-7">
      <PageHeader
        trail={[`@${username}`, "Postagens", "Compor"]}
        title="Compor"
        /*
         * Colado no título, como no artboard: a situação e quando foi salva
         * dizem respeito ao que se está olhando. As ações ficam com o
         * formulário, porque dependem do que ele tem em mãos.
         */
        besideTitle={
          <>
            <PostStatusBadge status={post.status} />
            <span className="text-[13px] text-muted-foreground tabular-nums">
              Salvo em <LocalDate iso={post.updatedAt} format="comHora" />
            </span>
          </>
        }
      />
      <ComposeForm username={username} timeZone={account.timezone} post={post} />
    </main>
  );
}
