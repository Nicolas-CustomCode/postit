import type { Metadata } from "next";
import type { ReactNode } from "react";
import { can, isPostEditable } from "@repo/shared";
import { civilFieldsFor } from "@/components/account-time";
import { LocalDate } from "@/components/local-date";
import { PageHeader } from "@/components/nav/page-header";
import { ComposeForm } from "@/components/posts/compose-form";
import { PostFailure } from "@/components/posts/post-failure";
import { PostStatusBadge } from "@/components/posts/post-status-badge";
import { PostView } from "@/components/posts/post-view";
import { requireSession } from "@/lib/auth/session";
import { listMedia } from "@/lib/data/media";
import { accountFor, getPost, getPostHistory } from "@/lib/data/posts";

export const metadata: Metadata = { title: "Postagem" };

/**
 * Uma postagem da conta ativa (docs/13, "Compor"; artboards `RevisaoDesktop` e
 * `FalhaCelular`).
 *
 * **Três telas no mesmo endereço, escolhidas pelo estado e pela permissão:**
 *
 * - **compor**, se ela ainda se edita e a pessoa tem `POSTAGEM_EDITAR`;
 * - **a falha**, em `FALHOU` — a causa, as três saídas e o histórico (ADR 0007);
 * - **só leitura** para o resto: publicada, saindo, descartada — e qualquer uma
 *   para quem não edita.
 *
 * ⚠️ **Ver não pede permissão.** Até 23/09/2026 esta página dava 404 a quem não
 * tinha `POSTAGEM_EDITAR`, mas o ADR 0015 diz que todo logado vê postagens — e a
 * lista, que ninguém bloqueia, já levava para cá. Esconder não é proteger: quem
 * decide o que cada um pode fazer é a API (regra 17).
 */
export default async function PostagemPage({
  params,
}: {
  readonly params: Promise<{ conta: string; id: string }>;
}): Promise<ReactNode> {
  const { user } = await requireSession();

  const { conta, id } = await params;
  const username = decodeURIComponent(conta);
  const [post, account] = await Promise.all([getPost(username, id), accountFor(username)]);

  const compondo = post.status !== "FAILED" && isPostEditable(post.status) && can(user, "POST_EDIT");
  const [media, history] = await Promise.all([
    // O acervo só serve a quem compõe; o histórico, a quem decide sobre a falha.
    compondo ? listMedia() : Promise.resolve([]),
    post.status === "FAILED" ? getPostHistory(username, id) : Promise.resolve([]),
  ]);

  return (
    <main className="mx-auto flex w-full max-w-6xl flex-1 flex-col gap-6 px-4 pb-8 md:px-10 md:py-7">
      <PageHeader
        trail={[`@${username}`, "Postagens", compondo ? "Compor" : "Postagem"]}
        title={compondo ? "Compor" : "Postagem"}
        /*
         * Colado no título, como no artboard: a situação e o momento que importa.
         * Na publicada, o momento é quando saiu — "salvo em" ali não diz nada.
         */
        besideTitle={
          <>
            <PostStatusBadge status={post.status} />
            <span className="text-[13px] text-muted-foreground tabular-nums">
              {post.publication === null ? (
                <>
                  Salvo em <LocalDate iso={post.updatedAt} format="comHora" />
                </>
              ) : (
                <>
                  Publicada em <LocalDate iso={post.publication.publishedAt} format="comHora" />
                </>
              )}
            </span>
          </>
        }
      />

      {compondo ? (
        <ComposeForm username={username} account={account} timeZone={account.timezone} media={media} post={post} />
      ) : post.status === "FAILED" ? (
        <PostFailure
          username={username}
          post={post}
          account={account}
          history={history}
          suggestion={nextFullHour(account.timezone)}
          canDecide={can(user, "POST_SCHEDULE")}
          canReconnect={can(user, "ACCOUNT_MANAGE")}
        />
      ) : (
        <PostView post={post} account={account} />
      )}
    </main>
  );
}

/**
 * A sugestão para reagendar: a próxima hora cheia, no fuso da conta — o "Hoje,
 * 20:00" do artboard `FalhaCelular`. Pelo menos uma hora adiante, para caber o
 * tempo de a pessoa decidir.
 */
function nextFullHour(timeZone: string): { day: string; time: string } {
  const { day, time } = civilFieldsFor(new Date(Date.now() + 60 * 60_000).toISOString(), timeZone);
  return { day, time: `${time.slice(0, 2)}:00` };
}
