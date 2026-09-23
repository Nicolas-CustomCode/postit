import type { ReactNode } from "react";
import type { PostDetail } from "@repo/shared";
import { ComposeSection } from "@/components/posts/compose-section";

/**
 * Texto alternativo de cada foto, com aviso quando falta (docs/07, "PostagemMidia";
 * artboard `RevisaoDesktop`, "Detalhes de cada foto"). Marcações entram aqui na
 * Fase 2; a linha já diz isso, para quem revisa não achar que foram esquecidas.
 *
 * Stories não tem: lá a Meta não recebe texto alternativo (docs/08).
 */
export function PhotoDetails({ post }: { readonly post: PostDetail }): ReactNode {
  if (post.media.length === 0 || post.format === "STORIES") return null;

  return (
    <ComposeSection
      title="Detalhes de cada foto"
      aside={
        <span className="text-[13px] text-muted-foreground tabular-nums">
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
              className="size-14 shrink-0 rounded-[10px] object-cover"
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
              <p className="mt-0.5 text-xs text-muted-foreground">Marcações: chegam na Fase 2</p>
            </div>
          </li>
        ))}
      </ol>
    </ComposeSection>
  );
}
