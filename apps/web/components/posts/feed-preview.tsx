"use client";

import { Bookmark, ChevronLeft, ChevronRight, Heart, ImageIcon, MessageCircle, Send } from "lucide-react";
import { useRef, useState, type PointerEvent as ReactPointerEvent, type ReactNode } from "react";
import type { AccountSummary, ComposableFormat, MediaSummary } from "@repo/shared";
import { AccountDateTime } from "@/components/account-time";
import { AccountAvatar } from "@/components/nav/account-avatar";
import { cn } from "@/lib/utils";

/**
 * Como a postagem vai aparecer (RF-C10; artboard `ComposicaoDesktop`).
 *
 * **Imita o Instagram de propósito**, com as cores deles — branco e preto puros,
 * a borda cinza, a fonte do sistema. Usar a paleta do PostIt faria a prévia
 * mentir sobre o resultado, que é a única coisa que ela precisa acertar.
 *
 * ⚠️ **Nada que o Instagram não mostre entra no cartão.** O horário previsto é
 * informação nossa, e dentro da moldura ele quebra a imitação: vira uma linha
 * que não existe no aplicativo, no lugar onde a pessoa está comparando com o que
 * conhece. Fica **abaixo** do cartão, junto da ressalva.
 *
 * ⚠️ **Stories não é o feed, e a prévia muda junto.** Lá a imagem ocupa a tela
 * em 9:16, não há barra de curtidas nem legenda por baixo.
 *
 * ⚠️ **No carrossel, o quadro é o da primeira foto, e as outras entram
 * inteiras**, com faixas pretas onde sobra (docs/08, observado em 23/09/2026). A
 * documentação da Meta diz "cropped", e até aqui a prévia recortava as outras —
 * aprovava-se uma imagem cheia e publicava-se uma com faixas.
 */
export function FeedPreview({
  account,
  format,
  media,
  caption,
  scheduledAt,
  publishedAt = null,
  timeZone,
}: {
  /** A conta: a prévia mostra a **foto real** dela, como o feed mostraria. */
  readonly account: Pick<AccountSummary, "name" | "username" | "photoUrl">;
  readonly format: ComposableFormat;
  /** As imagens na ordem final: a primeira define o quadro de todas. */
  readonly media: readonly MediaSummary[];
  readonly caption: string;
  readonly scheduledAt: string | null;
  /** Já publicada: o rodapé diz quando saiu, e não quando vai sair. */
  readonly publishedAt?: string | null;
  /** O horário sai no fuso da conta, não no do aparelho (ADR 0006). */
  readonly timeZone: string;
}): ReactNode {
  const stories = format === "STORIES";
  const [escolhido, setEscolhido] = useState(0);
  /*
   * ⚠️ Limitado na renderização, não num efeito: remover a última imagem
   * deixaria o índice além do fim e a prévia sairia em branco por um quadro.
   */
  const indice = Math.min(escolhido, Math.max(media.length - 1, 0));
  const atual = media[indice];
  const carrossel = !stories && media.length > 1;

  // A proporção da **primeira**, que é o quadro do carrossel inteiro. Com a
  // moldura vazia, 4:5 é só um lugar para a mensagem morar.
  const primeira = media[0];
  const recorte = primeira === undefined ? "4 / 5" : `${primeira.width} / ${primeira.height}`;

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
            <AccountAvatar account={account} />
            <span className="min-w-0 flex-1 truncate text-sm font-semibold">{account.username}</span>
          </div>
        )}

        <div className="relative">
          {atual === undefined ? (
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
          ) : carrossel ? (
            <FaixaDoCarrossel media={media} indice={indice} recorte={recorte} onIr={setEscolhido} />
          ) : (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={atual.url}
              alt=""
              className="w-full object-cover"
              style={{ aspectRatio: stories ? "9 / 16" : recorte }}
            />
          )}

          {carrossel && (
            <>
              {/* O contador do aplicativo, no mesmo canto. É ele que informa a
                  posição — por isso as setas e os pontinhos ficam decorativos. */}
              <span className="absolute top-2.5 right-2.5 rounded-full bg-black/60 px-2 py-0.5 text-[11px] font-semibold text-white">
                {indice + 1}/{media.length}
              </span>

              {/* Como o Instagram: a seta da ponta some, não fica apagada. */}
              {indice > 0 && (
                <SetaDaPrevia direcao="anterior" onClick={() => setEscolhido(indice - 1)} />
              )}
              {indice < media.length - 1 && (
                <SetaDaPrevia direcao="proxima" onClick={() => setEscolhido(indice + 1)} />
              )}
            </>
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
                <AccountAvatar account={account} className="size-7 ring-2 ring-white/70" />
                <span className="text-[13px] font-semibold" style={{ color: "#ffffff" }}>
                  {account.username}
                </span>
              </span>
            </>
          )}
        </div>

        {carrossel && (
          // Decorativos: o contador sobre a imagem já diz a posição em texto.
          <div className="flex justify-center gap-1.5 pt-2.5" aria-hidden>
            {media.map((_, posicao) => (
              <span
                key={posicao}
                className="size-1.5 rounded-full"
                style={{ background: posicao === indice ? "#0095f6" : "var(--ig-border)" }}
              />
            ))}
          </div>
        )}

        {!stories && (
          <>
            {/* A barra de ações do feed. Enfeite fiel: é o que faz a prévia
                parecer o feed, e não um cartão qualquer com uma foto. */}
            <div className="flex items-center gap-3.5 px-3 pt-2.5 pb-1.5" aria-hidden>
              <Heart className="size-6" strokeWidth={2} />
              <MessageCircle className="size-6" strokeWidth={2} />
              <Send className="size-6" strokeWidth={2} />
              <Bookmark className="ml-auto size-6" strokeWidth={2} />
            </div>

            <p className="px-3 pt-1 pb-3.5 text-sm/snug">
              <strong className="font-semibold">{account.username}</strong>{" "}
              {caption === "" ? (
                <span style={{ color: "var(--ig-muted)" }}>A legenda aparece aqui</span>
              ) : (
                <>
                  {caption.length > 120 ? `${caption.slice(0, 120)}…` : caption}
                  {caption.length > 120 && <span style={{ color: "var(--ig-muted)" }}> mais</span>}
                </>
              )}
            </p>
          </>
        )}
      </div>

      {/* Fora do cartão: é informação do PostIt, não do Instagram. */}
      <p className="flex flex-wrap gap-x-2 px-0.5 text-[13px] text-muted-foreground">
        {publishedAt !== null ? (
          <span>
            Publicada em <AccountDateTime iso={publishedAt} timeZone={timeZone} />.
          </span>
        ) : scheduledAt === null ? (
          <span>Ainda não agendada.</span>
        ) : (
          <span>
            Vai ao ar em <AccountDateTime iso={scheduledAt} timeZone={timeZone} />.
          </span>
        )}
        {stories && <span>Some 24 horas depois de publicada.</span>}
        {/* Depois de publicada não há ordem a mudar: a dica viraria instrução impossível. */}
        {carrossel && publishedAt === null && (
          <span>
            O carrossel usa o formato da primeira foto; as outras entram inteiras, com faixas pretas quando a
            proporção for diferente.
          </span>
        )}
      </p>

      <p className="px-0.5 text-xs/relaxed text-muted-foreground">
        Prévia aproximada. Não mostra localização, que a API oficial não permite, nem curtidas, que só
        existem depois de publicar.
      </p>
    </div>
  );
}

/** A seta redonda sobre a imagem, como o aplicativo desenha. */
/**
 * As fotos do carrossel lado a lado, arrastáveis como no aplicativo: a foto acompanha o
 * dedo — ou o mouse —, e ao soltar vai para a próxima ou volta, conforme o quanto andou
 * ou a velocidade do gesto.
 *
 * - **A página continua rolando na vertical** (`touch-action: pan-y`): só o arrasto
 *   horizontal é do carrossel.
 * - **Nas pontas, resiste**: o arrasto anda um terço, como o Instagram, dizendo que
 *   não há mais foto sem se mexer como se houvesse.
 * - **As setas continuam**, por cima: são o caminho de quem usa teclado ou leitor de tela.
 * - **Menos movimento, e não nenhum, para quem pediu** (`motion-reduce`): o deslize fica
 *   mais curto. Tirá-lo de todo fazia a troca parecer um corte seco — e no Windows com
 *   os efeitos de animação desligados, que é comum, era o que todo mundo via. É um
 *   deslize curto, dentro do quadro e em resposta ao gesto, não movimento decorativo.
 *
 * Da segunda em diante, cada foto entra inteira no quadro da primeira, com as faixas
 * pretas que o Instagram desenha (docs/08, observado em 23/09/2026).
 */
function FaixaDoCarrossel({
  media,
  indice,
  recorte,
  onIr,
}: {
  readonly media: readonly MediaSummary[];
  readonly indice: number;
  readonly recorte: string;
  readonly onIr: (indice: number) => void;
}): ReactNode {
  const quadro = useRef<HTMLDivElement>(null);
  const [arrasto, setArrasto] = useState<{ inicioX: number; inicioEm: number; dx: number } | null>(null);

  const ultima = media.length - 1;

  function comecar(evento: ReactPointerEvent<HTMLDivElement>): void {
    // As setas são botões: clicar nelas não é arrastar.
    if ((evento.target as HTMLElement).closest("button") !== null) return;
    if (evento.pointerType === "mouse" && evento.button !== 0) return;
    evento.currentTarget.setPointerCapture(evento.pointerId);
    setArrasto({ inicioX: evento.clientX, inicioEm: performance.now(), dx: 0 });
  }

  function mover(evento: ReactPointerEvent<HTMLDivElement>): void {
    if (arrasto === null) return;
    const bruto = evento.clientX - arrasto.inicioX;
    // Resistência nas pontas: um terço do caminho, e nada além.
    const naPonta = (indice === 0 && bruto > 0) || (indice === ultima && bruto < 0);
    setArrasto({ ...arrasto, dx: naPonta ? bruto / 3 : bruto });
  }

  function soltar(): void {
    if (arrasto === null) return;
    const largura = quadro.current?.clientWidth ?? 1;
    const duracao = performance.now() - arrasto.inicioEm;
    // Andou um quinto do quadro, ou foi um gesto rápido: troca de foto.
    const decidiu = Math.abs(arrasto.dx) > largura * 0.2 || (Math.abs(arrasto.dx) > 30 && duracao < 250);
    if (decidiu && arrasto.dx < 0 && indice < ultima) onIr(indice + 1);
    if (decidiu && arrasto.dx > 0 && indice > 0) onIr(indice - 1);
    setArrasto(null);
  }

  return (
    <div
      ref={quadro}
      className={cn(
        "relative w-full touch-pan-y overflow-hidden select-none",
        arrasto === null ? "cursor-grab" : "cursor-grabbing",
      )}
      style={{ aspectRatio: recorte }}
      onPointerDown={comecar}
      onPointerMove={mover}
      onPointerUp={soltar}
      onPointerCancel={soltar}
    >
      <div
        className={cn(
          "flex h-full",
          // Acompanha o dedo sem atraso; ao soltar, desliza até o lugar — rápido no começo
          // e assentando devagar, como no aplicativo.
          arrasto === null &&
            "transition-transform duration-300 ease-[cubic-bezier(0.22,1,0.36,1)] motion-reduce:duration-200",
        )}
        style={{ transform: `translateX(calc(${-indice * 100}% + ${arrasto?.dx ?? 0}px))` }}
      >
        {media.map((foto, posicao) => (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            key={posicao}
            src={foto.url}
            alt=""
            draggable={false}
            className={cn("h-full w-full shrink-0", posicao > 0 ? "object-contain" : "object-cover")}
            style={posicao > 0 ? { background: "var(--ig-letterbox)" } : undefined}
          />
        ))}
      </div>
    </div>
  );
}

function SetaDaPrevia({
  direcao,
  onClick,
}: {
  readonly direcao: "anterior" | "proxima";
  readonly onClick: () => void;
}): ReactNode {
  const anterior = direcao === "anterior";
  const Icone = anterior ? ChevronLeft : ChevronRight;

  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={anterior ? "Imagem anterior" : "Próxima imagem"}
      className={`absolute top-1/2 ${anterior ? "left-2" : "right-2"} flex size-7 -translate-y-1/2 items-center justify-center rounded-full transition-opacity hover:opacity-80`}
      style={{ background: "rgba(255,255,255,0.85)", color: "#262626" }}
    >
      <Icone className="size-4" aria-hidden />
    </button>
  );
}
