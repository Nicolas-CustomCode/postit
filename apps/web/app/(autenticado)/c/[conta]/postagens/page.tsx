import { ImageOff, Plus } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import type { ReactNode } from "react";
import { can, POST_FORMAT_LABELS } from "@repo/shared";
import { LocalDate } from "@/components/local-date";
import { PageHeader } from "@/components/nav/page-header";
import { PostStatusBadge } from "@/components/posts/post-status-badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { requireSession } from "@/lib/auth/session";
import { listPosts } from "@/lib/data/posts";

export const metadata: Metadata = { title: "Postagens" };

/**
 * A lista da conta ativa (docs/13, "Postagens").
 *
 * A conta vem do endereço, nunca de estado guardado (regra 24). Filtros por
 * status e período chegam quando houver volume para filtrar — hoje a lista
 * inteira cabe numa tela.
 */
export default async function PostagensPage({
  params,
}: {
  readonly params: Promise<{ conta: string }>;
}): Promise<ReactNode> {
  const { user } = await requireSession();
  const { conta } = await params;
  const username = decodeURIComponent(conta);
  const posts = await listPosts(username);
  const podeEditar = can(user, "POST_EDIT");

  return (
    <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-6 px-4 pb-8 md:px-10 md:py-7">
      <PageHeader
        trail={["Nesta conta", "Postagens"]}
        title="Postagens"
        description="O que está em rascunho, pronto e publicado nesta conta."
      />

      {podeEditar && (
        <Button asChild className="h-11 self-start md:h-10">
          <Link href={`/c/${username}/postagens/nova`}>
            <Plus className="size-4" aria-hidden />
            Nova postagem
          </Link>
        </Button>
      )}

      {posts.length === 0 ? (
        <Card className="flex flex-col items-center gap-2 rounded-2xl p-8 text-center">
          <p className="font-heading text-lg">Nenhuma postagem ainda</p>
          <p className="text-sm text-muted-foreground">
            {podeEditar
              ? "Comece uma agora: escolha a imagem e escreva a legenda."
              : "Quem tem permissão de editar pode criar a primeira."}
          </p>
        </Card>
      ) : (
        <ul className="flex flex-col gap-2">
          {posts.map((post) => (
            <li key={post.id}>
              <Link
                href={`/c/${username}/postagens/${post.id}`}
                className="flex min-h-20 items-center gap-3 rounded-2xl border bg-card p-3 hover:bg-muted"
              >
                {post.thumbnailUrl === null ? (
                  <span className="flex size-16 shrink-0 items-center justify-center rounded-xl bg-muted text-muted-foreground">
                    <ImageOff className="size-5" aria-hidden />
                  </span>
                ) : (
                  /*
                   * O endereço muda junto com o túnel; o otimizador do Next
                   * exigiria domínio fixo na configuração.
                   */
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={post.thumbnailUrl} alt="" className="size-16 shrink-0 rounded-xl object-cover" />
                )}

                <span className="flex min-w-0 flex-1 flex-col gap-1">
                  <span className="truncate text-sm font-medium">
                    {post.excerpt ?? <span className="text-muted-foreground">Sem legenda</span>}
                  </span>
                  <span className="text-xs text-muted-foreground">
                    {POST_FORMAT_LABELS[post.format]} · <LocalDate iso={post.updatedAt} format="comHora" />
                  </span>
                </span>

                <PostStatusBadge status={post.status} />
              </Link>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
