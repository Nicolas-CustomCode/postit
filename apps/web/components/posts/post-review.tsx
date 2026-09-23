import type { ReactNode } from "react";
import type { AccountSummary, PostDetail, PostHistoryEntry, PostTimelineEntry } from "@repo/shared";
import { FeedPreview } from "@/components/posts/feed-preview";
import { PhotoDetails } from "@/components/posts/photo-details";
import { PostTimeline } from "@/components/posts/post-timeline";
import { PublishHistory } from "@/components/posts/publish-history";
import { ReviewStateCard, type ReviewAbilities } from "@/components/posts/review-state-card";
import { previewFormat, previewMedia } from "@/lib/posts/preview";
import { cn } from "@/lib/utils";

/**
 * A etapa 2 · Revisão (ADR 0026; artboard `RevisaoDesktop`; protótipo aprovado em
 * 23/09/2026).
 *
 * A mesma página para todo estado depois do rascunho — e para quem só vê, em
 * qualquer estado: a prévia fiel e os detalhes de cada foto de um lado; do outro,
 * o cartão de estado e de decisão e os comentários com o histórico.
 *
 * ⚠️ **A ordem no celular é outra, e a grade resolve sem duplicar nada:** o cartão
 * primeiro (é o que a pessoa veio decidir), depois a prévia e as fotos, e os
 * comentários no fim. No computador, a prévia ocupa a coluna da esquerda inteira.
 */
export function PostReview({
  username,
  post,
  account,
  timeline,
  history,
  can,
  suggestion,
}: {
  readonly username: string;
  readonly post: PostDetail;
  readonly account: Pick<AccountSummary, "name" | "username" | "photoUrl" | "timezone">;
  readonly timeline: readonly PostTimelineEntry[];
  /** Só na que falhou: o passo a passo técnico, recolhido. */
  readonly history: readonly PostHistoryEntry[];
  readonly can: ReviewAbilities;
  readonly suggestion: { readonly day: string; readonly time: string };
}): ReactNode {
  // Com ações fixas no rodapé do celular, o fim da página precisa de folga para elas.
  const temRodape = can.approve || can.schedule;

  return (
    <div
      className={cn(
        "grid gap-5 lg:grid-cols-[360px_minmax(0,1fr)] lg:grid-rows-[auto_1fr] lg:items-start lg:gap-7",
        temRodape && "pb-24 md:pb-0",
      )}
    >
      <div className="flex min-w-0 flex-col gap-4 lg:col-start-2 lg:row-start-1">
        <ReviewStateCard username={username} post={post} account={account} can={can} suggestion={suggestion} />
        <PublishHistory history={history} timeZone={account.timezone} />
      </div>

      <div className="flex min-w-0 flex-col gap-4 lg:sticky lg:top-7 lg:col-start-1 lg:row-span-2 lg:row-start-1">
        <FeedPreview
          account={account}
          format={previewFormat(post)}
          media={previewMedia(post)}
          caption={post.caption ?? ""}
          scheduledAt={post.scheduledAt}
          publishedAt={post.publication?.publishedAt ?? null}
          timeZone={account.timezone}
        />
        <PhotoDetails post={post} />
      </div>

      <div className="min-w-0 lg:col-start-2 lg:row-start-2">
        <PostTimeline username={username} postId={post.id} entries={timeline} timeZone={account.timezone} />
      </div>
    </div>
  );
}
