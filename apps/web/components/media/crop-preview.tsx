"use client";

import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { cropAxis, cropRect, type ImageSpec } from "@repo/shared";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import type { LoadedImage } from "@/lib/media/crop-image";

/**
 * Escolher o que fica dentro do recorte (RF-B02, RF-B03; docs/04, "Proporção
 * fora").
 *
 * **Por que esta tela existe.** O feed do Instagram aceita de 4:5 a 1.91:1, e
 * foto de celular tirada em pé é 3:4 — mais alta que o limite. O app do
 * Instagram corta sozinho e ninguém percebe; aqui a pessoa vê o corte antes e
 * decide o que sobra, em vez de descobrir depois de publicado.
 *
 * ⚠️ **Só aparece quando a pessoa pede.** Recortar é escolha, não obstáculo: uma
 * arte 9:16 feita para Stories é válida como está, e recortá-la para 4:5 sem
 * perguntar destruiria o formato que ela queria. Quem chama diz **para qual
 * formato** é o recorte.
 *
 * **Um controle deslizante, e não arrastar com o dedo.** Só um eixo importa —
 * numa foto em pé, a largura já está inteira e o que se escolhe é a faixa
 * vertical. Um `range` funciona igual no computador e no celular, não depende de
 * gesto e é operável por teclado.
 */
export function CropPreview({
  image,
  ratio,
  spec,
  onConfirm,
  onCancel,
  busy,
}: {
  readonly image: LoadedImage;
  readonly ratio: number;
  /** O formato de destino do recorte — dá o nome e a faixa da explicação. */
  readonly spec: ImageSpec;
  readonly onConfirm: (position: number) => void;
  readonly onCancel: () => void;
  readonly busy: boolean;
}): ReactNode {
  const [position, setPosition] = useState(0.5);
  const canvas = useRef<HTMLCanvasElement>(null);

  const eixo = useMemo(() => cropAxis(image.width, image.height, ratio), [image.width, image.height, ratio]);

  // Desenha a prévia: a imagem inteira, escurecida onde o corte vai tirar.
  useEffect(() => {
    const elemento = canvas.current;
    const ctx = elemento?.getContext("2d");
    if (elemento === null || ctx === null || ctx === undefined) return;

    const escala = Math.min(1, 560 / image.width);
    elemento.width = Math.round(image.width * escala);
    elemento.height = Math.round(image.height * escala);

    ctx.drawImage(image.bitmap, 0, 0, elemento.width, elemento.height);

    // O que fica de fora some por baixo de um véu: é mais direto do que uma
    // moldura, porque mostra o resultado em vez de descrevê-lo.
    const corte = cropRect(image.width, image.height, ratio, position);
    ctx.fillStyle = "rgba(0, 0, 0, 0.62)";
    ctx.fillRect(0, 0, elemento.width, elemento.height);
    ctx.drawImage(
      image.bitmap,
      corte.x,
      corte.y,
      corte.width,
      corte.height,
      Math.round(corte.x * escala),
      Math.round(corte.y * escala),
      Math.round(corte.width * escala),
      Math.round(corte.height * escala),
    );
  }, [image, ratio, position]);

  return (
    <div className="flex flex-col gap-4">
      <div>
        <p className="text-sm font-medium">Recortar para {spec.label}</p>
        <p className="text-sm text-muted-foreground">
          O Instagram aceita de {spec.ratioLabel} nesse formato. Escolha a parte que fica.
        </p>
      </div>

      <canvas
        ref={canvas}
        className="w-full rounded-lg border bg-muted"
        role="img"
        aria-label="Prévia do recorte: a área clara é a que será publicada"
      />

      <div className="flex flex-col gap-2">
        <Label htmlFor="posicao-recorte">
          {eixo === "vertical" ? "Posição: do topo à base" : "Posição: da esquerda à direita"}
        </Label>
        <input
          id="posicao-recorte"
          type="range"
          min={0}
          max={100}
          step={1}
          value={Math.round(position * 100)}
          disabled={busy}
          onChange={(evento) => setPosition(Number(evento.target.value) / 100)}
          className="h-11 w-full accent-primary md:h-6"
        />
      </div>

      <div className="flex flex-col gap-2 md:flex-row">
        <Button type="button" className="h-11 md:h-10" disabled={busy} onClick={() => onConfirm(position)}>
          {busy ? "Enviando…" : "Usar este recorte"}
        </Button>
        <Button type="button" variant="outline" className="h-11 md:h-10" disabled={busy} onClick={onCancel}>
          Voltar
        </Button>
      </div>
    </div>
  );
}
