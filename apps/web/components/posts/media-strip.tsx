"use client";

import { ChevronLeft, ChevronRight, X } from "lucide-react";
import type { ReactNode } from "react";
import { formatsFor, IMAGE_SPECS, type ImageFormat, type MediaSummary } from "@repo/shared";
import { useDragReorder } from "@/components/posts/use-drag-reorder";
import { cn } from "@/lib/utils";

/**
 * As imagens da postagem, na ordem em que vão para a Meta (RF-C04).
 *
 * ⚠️ **A primeira manda.** A Meta recorta todas as imagens do carrossel pelo
 * recorte da primeira (docs/08), então "quem é a primeira" precisa ser
 * inequívoco — daí o selo com o número em cada miniatura.
 *
 * **Duas formas de reordenar, e as duas chamam o mesmo `onMover`:** arrastar,
 * que é o caminho natural, e as setas `◀ ▶`. As setas não são redundância — são
 * o que o docs/13 exige como alternativa a toda ação por gesto, e é por elas que
 * passa quem usa teclado, leitor de tela ou tem a mão trêmula.
 */
export function MediaStrip({
  midias,
  format,
  disabled,
  onMover,
  onRemover,
  acrescentar,
}: {
  readonly midias: readonly MediaSummary[];
  readonly format: ImageFormat;
  readonly disabled: boolean;
  readonly onMover: (de: number, para: number) => void;
  readonly onRemover: (indice: number) => void;
  /**
   * O quadrado de adicionar, que fecha a faixa. Ausente quando a postagem já
   * chegou ao máximo do formato — a faixa é também **onde se acrescenta**, e
   * não só onde se vê o que já existe.
   */
  readonly acrescentar?: ReactNode;
}): ReactNode {
  const { drag, containerRef, handlers } = useDragReorder({
    total: midias.length,
    onMover,
    disabled,
  });

  return (
    <ul ref={containerRef} className="flex snap-x gap-2 overflow-x-auto pb-1">
      {midias.map((item, indice) => {
        const serve = formatsFor(item.width, item.height).includes(format);
        const primeira = indice === 0;
        const ultima = indice === midias.length - 1;
        const naMao = drag?.indice === indice;
        // Quem fica entre a origem e o destino abre passagem: é o que mostra
        // onde a imagem vai cair, sem precisar de um espaço fantasma.
        const abrePassagem =
          drag !== null && !naMao && entre(indice, drag.indice, drag.destino) ? (drag.destino > drag.indice ? -1 : 1) : 0;

        return (
          /*
           * ⚠️ `key` pelo índice, de propósito: a mesma imagem pode aparecer
           * duas vezes na lista, e o `id` como chave faria o React embaralhar o
           * DOM. É o slot que tem identidade aqui, não a foto.
           */
          <li
            key={indice}
            data-midia
            className={cn(
              "flex shrink-0 snap-start flex-col gap-1",
              midias.length > 1 && !disabled && (naMao ? "cursor-grabbing" : "cursor-grab"),
              naMao && "z-10",
              /*
               * ⚠️ **A transição só existe durante o arrasto.** Ela serve para
               * os vizinhos abrirem passagem com suavidade enquanto a imagem
               * está na mão. Ao soltar, a lista já foi reordenada e cada item
               * está onde deve: animar aí faria a imagem escorregar do lugar
               * onde foi largada para o lugar onde já estava, que é justamente
               * a sensação de "não ficou onde eu soltei".
               */
              drag !== null && !naMao && "transition-transform",
              // Sem `touch-action` fixo: antes de o toque virar arrasto, a faixa
              // ainda precisa rolar com o dedo.
              drag !== null && "touch-none select-none",
            )}
            style={
              naMao
                ? { transform: `translateX(${drag.deslocamento}px) scale(1.05)` }
                : abrePassagem !== 0
                  ? // O passo é a largura mais o intervalo — `gap-2`, 0.5rem.
                    { transform: `translateX(calc(${abrePassagem} * (100% + 0.5rem)))` }
                  : undefined
            }
            {...handlers(indice)}
          >
            <div className={cn("relative", naMao && "shadow-lg")}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={item.url}
                alt=""
                width={item.width}
                height={item.height}
                /*
                 * ⚠️ **Imagem é arrastável por padrão no HTML.** Sem isto, pegar
                 * a miniatura com o mouse inicia o arrasto **nativo** do
                 * navegador — com a imagem fantasma pendurada no cursor — e o
                 * nosso nunca começa.
                 */
                draggable={false}
                className={cn("size-28 rounded-xl object-cover", !serve && "opacity-45")}
              />

              <span className="absolute top-1.5 left-1.5 flex size-6 items-center justify-center rounded-full bg-black/65 text-xs font-semibold text-white">
                {indice + 1}
              </span>

              <button
                type="button"
                disabled={disabled}
                onClick={() => onRemover(indice)}
                aria-label={`Remover a imagem ${indice + 1}`}
                className="absolute top-1.5 right-1.5 flex size-6 items-center justify-center rounded-full bg-black/65 text-white transition-opacity hover:opacity-80 disabled:opacity-40"
              >
                <X className="size-3.5" aria-hidden />
              </button>

              {!serve && (
                <span className="absolute inset-x-1.5 bottom-1.5 rounded-md bg-destructive px-1.5 py-0.5 text-center text-[11px] font-medium text-white">
                  Não serve para {IMAGE_SPECS[format].label}
                </span>
              )}
            </div>

            {/* Some com uma imagem só: não há para onde mover. */}
            {midias.length > 1 && (
              <div className="flex justify-between gap-1">
                <SetaDeOrdem
                  direcao="antes"
                  indice={indice}
                  disabled={disabled || primeira}
                  onClick={() => onMover(indice, indice - 1)}
                />
                <SetaDeOrdem
                  direcao="depois"
                  indice={indice}
                  disabled={disabled || ultima}
                  onClick={() => onMover(indice, indice + 1)}
                />
              </div>
            )}
          </li>
        );
      })}

      {/* `items-start` prende o quadrado no topo: com duas ou mais imagens o
          `<li>` estica para a altura das setas, e ele tem só a da foto.
          Sem `data-midia`: ele não é arrastável nem é destino de arrasto. */}
      {acrescentar !== undefined && (
        <li className="flex shrink-0 snap-start items-start">{acrescentar}</li>
      )}
    </ul>
  );
}

/** O item está no trecho que a imagem arrastada atravessa? */
function entre(indice: number, origem: number, destino: number): boolean {
  return destino > origem ? indice > origem && indice <= destino : indice < origem && indice >= destino;
}

function SetaDeOrdem({
  direcao,
  indice,
  disabled,
  onClick,
}: {
  readonly direcao: "antes" | "depois";
  readonly indice: number;
  readonly disabled: boolean;
  readonly onClick: () => void;
}): ReactNode {
  const Icone = direcao === "antes" ? ChevronLeft : ChevronRight;

  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      aria-label={`Mover a imagem ${indice + 1} para ${direcao}`}
      // h-8: alvo de toque confortável no celular sem comer a altura da faixa.
      className="flex h-8 flex-1 items-center justify-center rounded-lg bg-muted transition-colors hover:bg-accent disabled:opacity-40 disabled:hover:bg-muted"
    >
      <Icone className="size-4" aria-hidden />
    </button>
  );
}
