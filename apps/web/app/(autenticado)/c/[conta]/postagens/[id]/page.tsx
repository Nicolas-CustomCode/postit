import type { Metadata } from "next";
import type { ReactNode } from "react";
import { can, canApprovePost, pageStepFor } from "@repo/shared";
import { civilFieldsFor } from "@/components/account-time";
import { PageHeader } from "@/components/nav/page-header";
import { ComposeForm } from "@/components/posts/compose-form";
import { PostReview } from "@/components/posts/post-review";
import { PostStepper } from "@/components/posts/post-stepper";
import { requireSession } from "@/lib/auth/session";
import { listMedia } from "@/lib/data/media";
import { accountFor, getPost, getPostHistory, getPostTimeline } from "@/lib/data/posts";

export const metadata: Metadata = { title: "Postagem" };

/**
 * Uma postagem da conta ativa, em duas etapas (ADR 0026): **1 · Composição** e
 * **2 · Revisão**, com as etapas no topo, como num checkout.
 *
 * - **Composição** só para rascunho, e só para quem tem `POSTAGEM_EDITAR`;
 * - **Revisão** para todo o resto — em revisão, aprovada, agendada, publicando,
 *   publicada, falhou, descartada —, e sempre para quem não edita.
 *
 * ⚠️ **Ver não pede permissão.** O ADR 0015 diz que todo logado vê postagens, e a
 * lista, que ninguém bloqueia, já leva para cá. Os botões escondidos aqui são
 * conveniência: quem decide o que cada um pode fazer é a API (regra 17).
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

  const compondo = pageStepFor(post.status, user) === "compose";
  const [media, timeline, history] = await Promise.all([
    // O acervo só serve a quem compõe; a linha do tempo, à Revisão; o histórico técnico, à que falhou.
    compondo ? listMedia() : Promise.resolve([]),
    compondo ? Promise.resolve([]) : getPostTimeline(username, id),
    !compondo && post.status === "FAILED" ? getPostHistory(username, id) : Promise.resolve([]),
  ]);

  return (
    <main className="mx-auto flex w-full max-w-6xl flex-1 flex-col gap-5 px-4 pb-8 md:px-10 md:py-7">
      <PageHeader trail={[`@${username}`, "Postagens", "Postagem"]} title="Postagem" />
      <PostStepper post={post} timeZone={account.timezone} />

      {compondo ? (
        <ComposeForm
          username={username}
          account={account}
          timeZone={account.timezone}
          media={media}
          post={post}
          canApprove={canApprovePost(user, post.createdById)}
        />
      ) : (
        <PostReview
          username={username}
          post={post}
          account={account}
          timeline={timeline}
          history={history}
          suggestion={nextFullHour(account.timezone)}
          viewerId={user.id}
          can={{
            approve: canApprovePost(user, post.createdById),
            ownPostBlocked: can(user, "POST_APPROVE") && !canApprovePost(user, post.createdById),
            schedule: can(user, "POST_SCHEDULE"),
            edit: can(user, "POST_EDIT"),
            reconnect: can(user, "ACCOUNT_MANAGE"),
          }}
        />
      )}
    </main>
  );
}

/**
 * A sugestão para reagendar a que falhou: a próxima hora cheia, no fuso da conta —
 * o "Hoje, 20:00" do artboard `FalhaCelular`. Pelo menos uma hora adiante, para
 * caber o tempo de a pessoa decidir.
 */
function nextFullHour(timeZone: string): { day: string; time: string } {
  const { day, time } = civilFieldsFor(new Date(Date.now() + 60 * 60_000).toISOString(), timeZone);
  return { day, time: `${time.slice(0, 2)}:00` };
}
