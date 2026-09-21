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
 */
export function MediaPicker({
  media,
  format,
  selectedId,
  disabled,
  onSelect,
}: {
  readonly media: readonly MediaSummary[];
  /** O formato de destino: é ele que decide quais imagens servem. */
  readonly format: ImageFormat;
  readonly selectedId: string | null;
  readonly disabled?: boolean;
  readonly onSelect: (media: MediaSummary) => void;
}): ReactNode {
  const [aberto, setAberto] = useState(false);

  return (
    <Sheet open={aberto} onOpenChange={setAberto}>
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

        <div className="px-4 pb-6">
          <MediaGrid
            media={media}
            format={format}
            selectedId={selectedId}
            onSelect={(escolhida) => {
              onSelect(escolhida);
              setAberto(false);
            }}
          />
        </div>
      </SheetContent>
    </Sheet>
  );
}
