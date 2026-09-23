import { ExternalLink } from "lucide-react";
import type { ReactNode } from "react";
import { PUBLISH_FAILURES, PUBLISH_MAX_ATTEMPTS, type AccountSummary, type PostDetail } from "@repo/shared";
import { AccountDateTime } from "@/components/account-time";
import { ComposeSection } from "@/components/posts/compose-section";
import { FeedPreview } from "@/components/posts/feed-preview";
import { previewFormat, previewMedia } from "@/lib/posts/preview";

/**
 * A postagem **só para ver** (artboard `RevisaoDesktop`, na parte que existe na
 * Fase 1).
 *
 * Abre assim o que não se edita mais — publicada, saindo, descartada — e qualquer
 * postagem para quem não tem `POSTAGEM_EDITAR` (ADR 0015: todo logado vê).
 *
 * ⚠️ **Um componente próprio, e não o formulário com os controles apagados.**
 * Botão apagado é exatamente o que confundia: a publicada mostrava "Marcar como
 * pronta" e "Reagendar", e a pessoa ficava sem saber se ainda dava para mexer.
 * Aqui não há campo nem ação — só o que aconteceu.
 *
 * A prévia é o conteúdo, como no artboard; as informações vêm em cartões ao lado.
 * Comentários internos, colaboradores e "mostrar marcações" são da Fase 2/4 e não
 * aparecem ainda.
 */
export function PostView({
  post,
  account,
}: {
  readonly post: PostDetail;
  readonly account: Pick<AccountSummary, "name" | "username" | "photoUrl" | "timezone">;
}): ReactNode {
  return (
    <div className="flex flex-col gap-5 lg:flex-row lg:items-start lg:gap-7">
      <div className="w-full shrink-0 lg:w-90">
        <FeedPreview
          account={account}
          format={previewFormat(post)}
          media={previewMedia(post)}
          caption={post.caption ?? ""}
          scheduledAt={post.scheduledAt}
          publishedAt={post.publication?.publishedAt ?? null}
          timeZone={account.timezone}
        />
      </div>

      <div className="flex min-w-0 flex-1 flex-col gap-4">
        <Situacao post={post} timeZone={account.timezone} />
        <DetalhesDasFotos post={post} />
      </div>
    </div>
  );
}

/** O que está acontecendo com a postagem, dito uma vez, sem botão. */
function Situacao({ post, timeZone }: { readonly post: PostDetail; readonly timeZone: string }): ReactNode {
  if (post.status === "PUBLISHED") {
    return (
      <ComposeSection title="Publicação">
        <p className="text-sm">
          {post.publication === null ? (
            "Publicada."
          ) : (
            <>
              Publicada em <AccountDateTime iso={post.publication.publishedAt} timeZone={timeZone} />.
            </>
          )}
        </p>
        {post.publication?.permalink ? (
          <a
            href={post.publication.permalink}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex h-11 items-center gap-2 self-start rounded-[10px] border px-4 text-sm font-semibold transition-colors hover:bg-muted md:h-10"
          >
            <ExternalLink className="size-4" aria-hidden />
            Ver no Instagram
          </a>
        ) : (
          // V-28: confirmada pelo estado do container, sem o id da mídia.
          <p className="text-[13px] text-muted-foreground">
            Link indisponível: o Instagram confirmou a publicação, mas não devolveu o endereço do post.
          </p>
        )}
      </ComposeSection>
    );
  }

  if (post.status === "PROCESSING") {
    const tentando = post.attempts >= 1 && post.failureCause !== null;

    return (
      <ComposeSection title="Publicando">
        <p className="text-sm">Saindo em instantes.</p>
        {post.scheduledAt !== null && (
          <p className="text-[13px] text-muted-foreground">
            Marcada para <AccountDateTime iso={post.scheduledAt} timeZone={timeZone} />.
          </p>
        )}
        {/* docs/04, jornada 7: em retentativa, a pessoa vê em que ponto está e por quê. */}
        {tentando && post.failureCause !== null && (
          <p className="text-[13px] text-warning">
            Tentativa {post.attempts} de {PUBLISH_MAX_ATTEMPTS} — {PUBLISH_FAILURES[post.failureCause].message} O
            sistema tenta de novo sozinho.
          </p>
        )}
      </ComposeSection>
    );
  }

  if (post.status === "CANCELED") {
    return (
      <ComposeSection title="Descartada">
        <p className="text-sm text-muted-foreground">Esta postagem foi descartada e não vai ao ar.</p>
      </ComposeSection>
    );
  }

  // Qualquer outro estado chega aqui só para quem pode ver e não pode editar.
  return (
    <ComposeSection title="Situação">
      <p className="text-sm">
        {post.scheduledAt === null ? (
          "Ainda não agendada."
        ) : (
          <>
            Vai ao ar em <AccountDateTime iso={post.scheduledAt} timeZone={timeZone} />.
          </>
        )}
      </p>
      <p className="text-[13px] text-muted-foreground">Você pode ver esta postagem, mas não editar.</p>
    </ComposeSection>
  );
}

/**
 * Texto alternativo de cada foto, com aviso quando falta (docs/07, "PostagemMidia";
 * artboard `RevisaoDesktop`, "Detalhes de cada foto"). Marcações entram aqui na
 * Fase 2.
 */
function DetalhesDasFotos({ post }: { readonly post: PostDetail }): ReactNode {
  if (post.media.length === 0 || post.format === "STORIES") return null;

  return (
    <ComposeSection
      title="Detalhes de cada foto"
      aside={
        <span className="text-[13px] text-muted-foreground">
          {post.media.length} {post.media.length === 1 ? "foto" : "fotos"}
        </span>
      }
    >
      <ol className="flex flex-col gap-3">
        {post.media.map((item, indice) => (
          <li key={indice} className="flex items-start gap-3">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={item.url}
              alt=""
              width={item.width}
              height={item.height}
              className="size-16 shrink-0 rounded-xl object-cover"
            />
            <div className="min-w-0">
              <p className="text-sm font-semibold">Foto {indice + 1}</p>
              {item.altText ? (
                <p className="text-sm break-words text-muted-foreground">{item.altText}</p>
              ) : (
                <p className="text-[13px] text-warning">
                  Texto alternativo não preenchido. Leitores de tela não vão descrever esta foto.
                </p>
              )}
            </div>
          </li>
        ))}
      </ol>
    </ComposeSection>
  );
}
