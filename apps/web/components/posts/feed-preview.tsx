import { Bookmark, Heart, ImageIcon, MessageCircle, Send } from "lucide-react";
import type { ReactNode } from "react";
import type { PostMediaItem } from "@repo/shared";

/**
 * Como a postagem vai aparecer no feed (RF-C10; artboard `ComposicaoDesktop`).
 *
 * **Imita o Instagram de propósito**, com as cores deles — branco e preto puros,
 * a borda cinza, a fonte do sistema. Usar a paleta do PostIt faria a prévia
 * mentir sobre o resultado, que é a única coisa que ela precisa acertar.
 *
 * A legenda aparece truncada como lá, com o "mais" depois do primeiro trecho, e
 * o @ em negrito na frente. É onde se percebe que a legenda começa com hashtag
 * antes de publicar.
 */
export function FeedPreview({
  username,
  media,
  caption,
}: {
  readonly username: string;
  readonly media: readonly PostMediaItem[];
  readonly caption: string;
}): ReactNode {
  const imagem = media[0];
  const iniciais = username.slice(0, 2).toUpperCase();

  return (
    <div className="flex flex-col gap-2.5">
      <div className="flex items-baseline justify-between gap-3 px-0.5">
        <h2 className="font-heading text-lg font-bold">Prévia</h2>
        <span className="text-[13px] text-muted-foreground">Como vai aparecer no feed</span>
      </div>

      <div
        className="flex flex-col overflow-hidden rounded-2xl border font-sans"
        style={{ background: "var(--ig-bg)", color: "var(--ig-text)", borderColor: "var(--ig-border)" }}
      >
        <div className="flex items-center gap-2.5 px-3 py-2.5">
          <span
            className="flex size-8 shrink-0 items-center justify-center rounded-full text-[11px] font-extrabold"
            style={{ background: "#262f9b", color: "#c6f432" }}
          >
            {iniciais}
          </span>
          <span className="min-w-0 flex-1 truncate text-sm font-semibold">{username}</span>
        </div>

        {imagem === undefined ? (
          <div
            className="flex aspect-square w-full flex-col items-center justify-center gap-2 text-sm"
            style={{ background: "var(--ig-border)", color: "var(--ig-muted)" }}
          >
            <ImageIcon className="size-7" aria-hidden />
            Sem imagem ainda
          </div>
        ) : (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={imagem.url} alt="" className="w-full object-cover" style={{ aspectRatio: "4 / 5" }} />
        )}

        {/* A barra de ações do Instagram. Enfeite fiel: é o que faz a prévia
            parecer o feed, e não um cartão qualquer com uma foto. */}
        <div className="flex items-center gap-3.5 px-3 pt-2.5 pb-1.5" aria-hidden>
          <Heart className="size-6" strokeWidth={2} />
          <MessageCircle className="size-6" strokeWidth={2} />
          <Send className="size-6" strokeWidth={2} />
          <Bookmark className="ml-auto size-6" strokeWidth={2} />
        </div>

        <p className="px-3 pt-1 text-sm/snug">
          <strong className="font-semibold">{username}</strong>{" "}
          {caption === "" ? (
            <span style={{ color: "var(--ig-muted)" }}>A legenda aparece aqui</span>
          ) : (
            <>
              {caption.length > 120 ? `${caption.slice(0, 120)}…` : caption}
              {caption.length > 120 && <span style={{ color: "var(--ig-muted)" }}> mais</span>}
            </>
          )}
        </p>

        <p
          className="px-3 pt-2 pb-3.5 text-[11px] tracking-[0.04em] uppercase"
          style={{ color: "var(--ig-muted)" }}
        >
          Ainda não agendada
        </p>
      </div>

      <p className="px-0.5 text-xs/relaxed text-muted-foreground">
        Prévia aproximada. Não mostra localização, que a API oficial não permite, nem curtidas, que só
        existem depois de publicar.
      </p>
    </div>
  );
}
