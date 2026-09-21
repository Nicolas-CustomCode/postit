import { ChevronLeft, ChevronRight, X } from "lucide-react";
import type { ReactNode } from "react";
import { formatsFor, IMAGE_SPECS, type ImageFormat, type MediaSummary } from "@repo/shared";
import { cn } from "@/lib/utils";

/**
 * As imagens da postagem, na ordem em que vão para a Meta (RF-C04).
 *
 * ⚠️ **A primeira manda.** A Meta recorta todas as imagens do carrossel pelo
 * recorte da primeira (docs/08), então "quem é a primeira" precisa ser
 * inequívoco — daí o selo com o número em cada miniatura.
 *
 * ⚠️ **Botões, e não arrastar.** Reordenar por gesto exigiria biblioteca e
 * ainda assim sairia ruim no celular, que é onde este sistema vive. Três alvos
 * de toque resolvem, funcionam no teclado e já são o que o docs/13 pede como
 * alternativa a qualquer gesto.
 */
export function MediaStrip({
  midias,
  format,
  disabled,
  onMover,
  onRemover,
}: {
  readonly midias: readonly MediaSummary[];
  readonly format: ImageFormat;
  readonly disabled: boolean;
  readonly onMover: (de: number, para: number) => void;
  readonly onRemover: (indice: number) => void;
}): ReactNode {
  return (
    <ul className="flex snap-x gap-2 overflow-x-auto pb-1">
      {midias.map((item, indice) => {
        const serve = formatsFor(item.width, item.height).includes(format);
        const primeira = indice === 0;
        const ultima = indice === midias.length - 1;

        return (
          /*
           * ⚠️ `key` pelo índice, de propósito: a mesma imagem pode aparecer
           * duas vezes na lista, e o `id` como chave faria o React embaralhar o
           * DOM. É o slot que tem identidade aqui, não a foto.
           */
          <li key={indice} className="flex shrink-0 snap-start flex-col gap-1">
            <div className="relative">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={item.url}
                alt=""
                width={item.width}
                height={item.height}
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
    </ul>
  );
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
