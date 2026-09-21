import { Bookmark, Heart, ImageIcon, MessageCircle, Send } from "lucide-react";
import type { ReactNode } from "react";
import type { ComposableFormat, MediaSummary } from "@repo/shared";
import { AccountDateTime } from "@/components/account-time";

/**
 * Como a postagem vai aparecer (RF-C10; artboard `ComposicaoDesktop`).
 *
 * **Imita o Instagram de propósito**, com as cores deles — branco e preto puros,
 * a borda cinza, a fonte do sistema. Usar a paleta do PostIt faria a prévia
 * mentir sobre o resultado, que é a única coisa que ela precisa acertar.
 *
 * ⚠️ **Stories não é o feed, e a prévia muda junto.** Lá a imagem ocupa a tela
 * em 9:16, não há barra de curtidas nem legenda por baixo, e o conteúdo some em
 * 24 horas. Mostrar o cartão do feed para um Story seria a prévia mentindo
 * justamente no que ela existe para acertar.
 */
export function FeedPreview({
  username,
  format,
  media,
  caption,
  scheduledAt,
  timeZone,
}: {
  readonly username: string;
  readonly format: ComposableFormat;
  readonly media: MediaSummary | null;
  readonly caption: string;
  readonly scheduledAt: string | null;
  /** O horário sai no fuso da conta, não no do aparelho (ADR 0006). */
  readonly timeZone: string;
}): ReactNode {
  const stories = format === "STORIES";
  const iniciais = username.slice(0, 2).toUpperCase();

  return (
    <div className="flex flex-col gap-2.5">
      <div className="flex items-baseline justify-between gap-3 px-0.5">
        <h2 className="font-heading text-lg font-bold">Prévia</h2>
        <span className="text-[13px] text-muted-foreground">
          {stories ? "Como vai aparecer nos Stories" : "Como vai aparecer no feed"}
        </span>
      </div>

      <div
        className="flex flex-col overflow-hidden rounded-2xl border font-sans"
        style={{ background: "var(--ig-bg)", color: "var(--ig-text)", borderColor: "var(--ig-border)" }}
      >
        {/* Nos Stories o perfil fica **sobre** a imagem, não acima dela. */}
        {!stories && (
          <div className="flex items-center gap-2.5 px-3 py-2.5">
            <Avatar iniciais={iniciais} />
            <span className="min-w-0 flex-1 truncate text-sm font-semibold">{username}</span>
          </div>
        )}

        <div className="relative">
          {media === null ? (
            <div
              className="flex w-full flex-col items-center justify-center gap-2 text-sm"
              style={{
                aspectRatio: stories ? "9 / 16" : "1 / 1",
                background: "var(--ig-border)",
                color: "var(--ig-muted)",
              }}
            >
              <ImageIcon className="size-7" aria-hidden />
              Sem imagem ainda
            </div>
          ) : (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={media.url}
              alt=""
              className="w-full object-cover"
              style={{ aspectRatio: stories ? "9 / 16" : "4 / 5" }}
            />
          )}

          {stories && (
            <>
              {/* A barra de progresso e o perfil, como o aplicativo desenha. */}
              <span
                className="absolute top-2.5 right-3 left-3 h-0.5 rounded-full"
                style={{ background: "rgba(255,255,255,0.55)" }}
                aria-hidden
              />
              <span className="absolute top-5 left-3 flex items-center gap-2">
                <Avatar iniciais={iniciais} small />
                <span className="text-[13px] font-semibold" style={{ color: "#ffffff" }}>
                  {username}
                </span>
              </span>
            </>
          )}
        </div>

        {stories ? (
          <p className="px-3 py-3 text-[11px] tracking-[0.04em] uppercase" style={{ color: "var(--ig-muted)" }}>
            Some em 24 horas · {quando(scheduledAt, timeZone)}
          </p>
        ) : (
          <>
            {/* A barra de ações do feed. Enfeite fiel: é o que faz a prévia
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
              {quando(scheduledAt, timeZone)}
            </p>
          </>
        )}
      </div>

      <p className="px-0.5 text-xs/relaxed text-muted-foreground">
        Prévia aproximada. Não mostra localização, que a API oficial não permite, nem curtidas, que só
        existem depois de publicar.
      </p>
    </div>
  );
}

function quando(scheduledAt: string | null, timeZone: string): ReactNode {
  if (scheduledAt === null) return "Ainda não agendada";
  return (
    <>
      Previsto para <AccountDateTime iso={scheduledAt} timeZone={timeZone} />
    </>
  );
}

function Avatar({ iniciais, small = false }: { readonly iniciais: string; readonly small?: boolean }): ReactNode {
  return (
    <span
      className={`flex shrink-0 items-center justify-center rounded-full font-extrabold ${small ? "size-7 text-[10px]" : "size-8 text-[11px]"}`}
      style={{ background: "#262f9b", color: "#c6f432" }}
    >
      {iniciais}
    </span>
  );
}
