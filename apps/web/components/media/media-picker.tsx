"use client";

import { useState, type ReactNode } from "react";
import type { ImageFormat, MediaSummary } from "@repo/shared";
import { MediaGrid } from "@/components/media/media-grid";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { cn } from "@/lib/utils";

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
  open,
  onOpenChange,
  onConfirm,
}: {
  readonly media: readonly MediaSummary[];
  /** O formato de destino: é ele que decide quais imagens servem. */
  readonly format: ImageFormat;
  /** Quantas ainda cabem na postagem. Escolher além disso fica apagado. */
  readonly remaining: number;
  /**
   * Controlado de fora: quem abre é o menu do quadrado de adicionar. É o que
   * permite o diálogo ser **irmão** do menu, e não filho dele — aninhado, o
   * fechamento do menu levaria o foco do diálogo junto.
   */
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly onConfirm: (media: readonly MediaSummary[]) => void;
}): ReactNode {
  const [pendentes, setPendentes] = useState<readonly MediaSummary[]>([]);

  const cheia = pendentes.length >= remaining;

  return (
    <Sheet
      open={open}
      onOpenChange={(proximo) => {
        onOpenChange(proximo);
        // Cada abertura começa do zero: seleção que sobrou de uma desistência
        // anterior viraria imagem acrescentada sem ninguém pedir.
        if (!proximo) setPendentes([]);
      }}
    >
      {/*
        ⚠️ **Folha embaixo no celular, caixa centrada no computador — por
        classes.** O projeto não tem hook de breakpoint, e renderizar dois
        contêineres faria dois `role="dialog"` na página. Um só, com o par `md:`
        de cada utilitário da base.

        ⚠️ **`md:right-auto` não é enfeite.** `side="bottom"` traz `inset-x-0`
        (= `left:0; right:0`); sem anular o `right`, a caixa continua grudada nas
        duas bordas e o `md:left-1/2` só a empurra.
      */}
      <SheetContent
        side="bottom"
        className={cn(
          "max-h-[85dvh] overflow-y-auto rounded-t-2xl",
          "md:top-1/2 md:right-auto md:bottom-auto md:left-1/2 md:w-full md:max-w-2xl",
          "md:-translate-x-1/2 md:-translate-y-1/2 md:rounded-2xl md:border",
        )}
      >
        <SheetHeader>
          <SheetTitle className="font-heading">Escolher do acervo</SheetTitle>
        </SheetHeader>

        {/* No celular a folha encosta na borda: o rodapé respeita a área segura. */}
        <div className="flex flex-col gap-4 px-4 pb-[calc(1.5rem+env(safe-area-inset-bottom))] md:pb-6">
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
              onOpenChange(false);
              setPendentes([]);
            }}
          >
            {/* "Usar", e não "adicionar": é o mesmo verbo da confirmação do
                envio, e as duas portas terminam no mesmo gesto. */}
            {pendentes.length <= 1 ? "Usar esta imagem" : `Usar ${pendentes.length} imagens`}
          </Button>
        </div>
      </SheetContent>
    </Sheet>
  );
}
