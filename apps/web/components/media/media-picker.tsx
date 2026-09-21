"use client";

import { Images } from "lucide-react";
import { useState, type ReactNode } from "react";
import type { ImageFormat, MediaSummary } from "@repo/shared";
import { MediaGrid } from "@/components/media/media-grid";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";

/**
 * Escolher uma imagem do acervo, na composição (RF-B04).
 *
 * É a metade que faltava: o Acervo recebia imagens que nunca eram usadas,
 * porque a composição mandava uma nova a cada postagem. Agora a seção Mídia tem
 * **duas portas** — esta e o envio.
 *
 * A folha vem do mesmo `Sheet` que a barra inferior usa: no celular ela sobe de
 * baixo, que é onde o polegar alcança.
 *
 * ⚠️ **Escolha várias de uma vez.** Montar um carrossel de cinco reabrindo a
 * folha cinco vezes seria castigo — clicar alterna, e um botão no fim confirma.
 */
export function MediaPicker({
  media,
  format,
  remaining,
  disabled,
  onConfirm,
}: {
  readonly media: readonly MediaSummary[];
  /** O formato de destino: é ele que decide quais imagens servem. */
  readonly format: ImageFormat;
  /** Quantas ainda cabem na postagem. Escolher além disso fica apagado. */
  readonly remaining: number;
  readonly disabled?: boolean;
  readonly onConfirm: (media: readonly MediaSummary[]) => void;
}): ReactNode {
  const [aberto, setAberto] = useState(false);
  const [pendentes, setPendentes] = useState<readonly MediaSummary[]>([]);

  const cheia = pendentes.length >= remaining;

  return (
    <Sheet
      open={aberto}
      onOpenChange={(proximo) => {
        setAberto(proximo);
        // Cada abertura começa do zero: seleção que sobrou de uma desistência
        // anterior viraria imagem acrescentada sem ninguém pedir.
        if (!proximo) setPendentes([]);
      }}
    >
      <SheetTrigger asChild>
        <Button type="button" variant="outline" className="h-11 justify-start gap-2 md:h-10" disabled={disabled}>
          <Images className="size-4" aria-hidden />
          Escolher do acervo
        </Button>
      </SheetTrigger>

      <SheetContent side="bottom" className="max-h-[85dvh] overflow-y-auto">
        <SheetHeader>
          <SheetTitle className="font-heading">Escolher do acervo</SheetTitle>
        </SheetHeader>

        <div className="flex flex-col gap-4 px-4 pb-6">
          <MediaGrid
            media={media}
            format={format}
            selectedIds={pendentes.map((item) => item.id)}
            // Cheia, só dá para tirar da seleção: `onSelect` continua chegando
            // para as já escolhidas, e a grade apaga o resto.
            disabledIds={cheia ? media.filter((item) => !pendentes.includes(item)).map((item) => item.id) : []}
            onSelect={(escolhida) =>
              setPendentes((atual) =>
                atual.includes(escolhida) ? atual.filter((item) => item !== escolhida) : [...atual, escolhida],
              )
            }
          />

          <Button
            type="button"
            className="h-11 md:h-10"
            disabled={pendentes.length === 0}
            onClick={() => {
              onConfirm(pendentes);
              setAberto(false);
              setPendentes([]);
            }}
          >
            {pendentes.length <= 1 ? "Adicionar imagem" : `Adicionar ${pendentes.length} imagens`}
          </Button>
        </div>
      </SheetContent>
    </Sheet>
  );
}
