"use client";

import { ImageOff } from "lucide-react";
import type { ReactNode } from "react";
import { formatsFor, IMAGE_SPECS, type ImageFormat, type MediaSummary } from "@repo/shared";
import { cn } from "@/lib/utils";

/**
 * A grade do acervo (RF-B04).
 *
 * Serve às duas telas: no Acervo mostra o que existe, e na composição é o
 * seletor. A diferença é `format` — com ele, cada imagem passa a dizer se serve
 * ao formato escolhido.
 *
 * ⚠️ **As incompatíveis aparecem apagadas, não escondidas.** Quem enviou uma
 * arte 9:16 e está compondo para o feed precisa **ver** que ela está lá e por
 * que não pode escolhê-la. Escondê-la faria a pessoa procurar uma foto que sabe
 * que enviou e não achar — e concluir que o envio falhou.
 */
export function MediaGrid({
  media,
  format,
  selectedId,
  onSelect,
}: {
  readonly media: readonly MediaSummary[];
  /** O formato de destino. Sem ele, a grade só mostra — não filtra nada. */
  readonly format?: ImageFormat;
  readonly selectedId?: string | null;
  readonly onSelect?: (media: MediaSummary) => void;
}): ReactNode {
  if (media.length === 0) {
    return (
      <div className="flex flex-col items-center gap-2 rounded-2xl border border-dashed p-8 text-center">
        <ImageOff className="size-6 text-muted-foreground" aria-hidden />
        <p className="font-heading text-lg">Nenhuma imagem ainda</p>
        <p className="text-sm text-muted-foreground">
          O que você enviar fica aqui, pronto para virar postagem em qualquer conta.
        </p>
      </div>
    );
  }

  return (
    <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
      {media.map((item) => {
        const serve = format === undefined || formatsFor(item.width, item.height).includes(format);
        const selecionada = selectedId === item.id;
        const clicavel = onSelect !== undefined && serve;

        return (
          <li key={item.id}>
            <button
              type="button"
              disabled={!clicavel}
              onClick={() => onSelect?.(item)}
              className={cn(
                "flex w-full flex-col gap-1.5 rounded-xl border p-1.5 text-left transition-colors",
                clicavel && "hover:bg-muted",
                selecionada && "border-primary ring-2 ring-accent",
                !serve && "opacity-45",
                onSelect === undefined && "cursor-default",
              )}
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={item.url}
                alt=""
                className="aspect-square w-full rounded-lg object-cover"
                width={item.width}
                height={item.height}
              />
              <span className="px-0.5 text-[11px] text-muted-foreground tabular-nums">
                {item.width} × {item.height}
              </span>
              {!serve && format !== undefined && (
                <span className="px-0.5 text-[11px] font-semibold text-warning">
                  Não serve para {IMAGE_SPECS[format].label}
                </span>
              )}
            </button>
          </li>
        );
      })}
    </ul>
  );
}
