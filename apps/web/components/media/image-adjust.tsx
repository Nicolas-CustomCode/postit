"use client";

import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { cropAxis, cropRect, fitFrame, type CropPosition, type ImageSpec } from "@repo/shared";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import type { LoadedImage } from "@/lib/media/crop-image";
import { cn } from "@/lib/utils";

/**
 * Fazer a imagem caber no formato, sem perdê-la (RF-B02, RF-B03; ADR 0025).
 *
 * **Por que esta tela existe.** A API do Instagram aceita de 4:5 a 1.91:1 no
 * feed, e foto de celular tirada em pé é 3:4 — mais alta que o limite. O
 * aplicativo aceita 3:4 desde 2025 e corta sozinho; a API não acompanhou
 * (docs/08). Aqui a pessoa vê o que vai acontecer e decide.
 *
 * **Duas saídas, uma tela.** Recortar tira as pontas; emoldurar cabe a imagem
 * inteira e põe barras. São duas respostas à mesma pergunta, feita na mesma
 * hora — e a pessoa precisa **comparar**: alternar no mesmo desenho é um toque,
 * em duas telas seria navegação.
 *
 * ⚠️ **Só aparece quando a pessoa pede.** Recortar é escolha, não obstáculo
 * (AGENTS.md, regra 10): uma arte 9:16 feita para Stories é válida como está, e
 * recortá-la para 4:5 sem perguntar destruiria o formato que ela queria. Quem
 * chama diz **para qual formato** é o ajuste.
 *
 * **Um controle deslizante, e não arrastar com o dedo.** Só um eixo importa —
 * numa foto em pé, a largura já está inteira e o que se escolhe é a faixa
 * vertical. Um `range` funciona igual no computador e no celular, não depende de
 * gesto e é operável por teclado.
 *
 * **Também casa uma foto com a primeira do carrossel** (`toFirstPhoto`): o quadro do
 * carrossel é o da primeira, e a foto de proporção diferente sai com faixas pretas
 * (docs/08, observado em 23/09/2026). Aí só existe recortar — "imagem inteira"
 * recriaria as faixas que a pessoa quer tirar.
 */
export type AdjustChoice =
  | { readonly mode: "crop"; readonly position: CropPosition }
  | { readonly mode: "fit" };

export function ImageAdjust({
  image,
  ratio,
  spec,
  onConfirm,
  onCancel,
  busy,
  toFirstPhoto = false,
}: {
  readonly image: LoadedImage;
  /** A proporção alvo do recorte — a mais próxima da original. */
  readonly ratio: number;
  /** O formato de destino — dá o nome e a faixa da explicação. */
  readonly spec: ImageSpec;
  readonly onConfirm: (escolha: AdjustChoice) => void;
  readonly onCancel: () => void;
  readonly busy: boolean;
  /** Recortar na proporção da primeira foto do carrossel, em vez de ajustar ao formato. */
  readonly toFirstPhoto?: boolean;
}): ReactNode {
  const [modo, setModo] = useState<AdjustChoice["mode"]>("crop");
  const [position, setPosition] = useState(0.5);
  const canvas = useRef<HTMLCanvasElement>(null);

  const eixo = useMemo(() => cropAxis(image.width, image.height, ratio), [image.width, image.height, ratio]);
  // Casando com a primeira foto não há moldura: ela recriaria as faixas.
  const moldura = useMemo(
    () => (toFirstPhoto ? null : fitFrame(image.width, image.height, spec)),
    [image.width, image.height, spec, toFirstPhoto],
  );

  useEffect(() => {
    const elemento = canvas.current;
    const ctx = elemento?.getContext("2d");
    if (elemento === null || ctx === null || ctx === undefined) return;

    if (modo === "fit" && moldura !== null) {
      // O desenho tem a forma da **moldura**, não da imagem: é o arquivo que
      // vai sair daqui.
      const escala = Math.min(1, 560 / moldura.width);
      elemento.width = Math.round(moldura.width * escala);
      elemento.height = Math.round(moldura.height * escala);

      ctx.fillStyle = "#FFFFFF";
      ctx.fillRect(0, 0, elemento.width, elemento.height);
      ctx.drawImage(
        image.bitmap,
        0,
        0,
        image.width,
        image.height,
        Math.round(moldura.image.x * escala),
        Math.round(moldura.image.y * escala),
        Math.round(moldura.image.width * escala),
        Math.round(moldura.image.height * escala),
      );
      return;
    }

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
  }, [image, ratio, position, modo, moldura]);

  return (
    <div className="flex flex-col gap-4">
      {toFirstPhoto ? (
        <div>
          <p className="text-sm font-medium">Ajustar ao formato da foto 1</p>
          <p className="text-sm text-muted-foreground">
            O carrossel usa o formato da primeira foto, e as outras entram inteiras, com faixas pretas. Escolha a
            parte que fica.
          </p>
        </div>
      ) : (
        <div>
          <p className="text-sm font-medium">Ajustar para {spec.label}</p>
          <p className="text-sm text-muted-foreground">
            {/* Condicional: um formato sem faixa não chega aqui hoje, mas a frase
                sairia dizendo "de null" se chegasse. */}
            {spec.ratioLabel !== null && <>O {spec.label} aceita de {spec.ratioLabel}. </>}
            {modo === "crop"
              ? "Escolha a parte que fica."
              : "A imagem inteira cabe, com faixas brancas nas sobras."}
          </p>
        </div>
      )}

      {moldura !== null && (
        <div className="flex gap-2" role="group" aria-label="Como ajustar">
          <Pilula ativa={modo === "crop"} disabled={busy} onClick={() => setModo("crop")}>
            Recortar
          </Pilula>
          <Pilula ativa={modo === "fit"} disabled={busy} onClick={() => setModo("fit")}>
            Imagem inteira
          </Pilula>
        </div>
      )}

      {/* A borda é o que torna a moldura branca visível sobre o fundo claro. */}
      <canvas
        ref={canvas}
        className="w-full rounded-lg border bg-muted"
        role="img"
        aria-label={
          modo === "crop"
            ? "Prévia do recorte: a área clara é a que será publicada"
            : `Prévia do enquadramento: a imagem inteira dentro da moldura de ${spec.label}`
        }
      />

      {/*
        ⚠️ **Nada de controle no modo "imagem inteira".** Sem zoom não há grau de
        liberdade nenhum: a imagem ocupa o eixo que não ganhou faixa e fica
        centrada no outro. Um controle ali só permitiria faixa assimétrica.
      */}
      {modo === "crop" && (
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
      )}

      <div className="flex flex-col gap-2 md:flex-row">
        <Button
          type="button"
          className="h-11 md:h-10"
          disabled={busy}
          onClick={() => onConfirm(modo === "fit" ? { mode: "fit" } : { mode: "crop", position })}
        >
          {busy ? "Enviando…" : modo === "crop" ? "Usar este recorte" : "Usar a imagem inteira"}
        </Button>
        <Button type="button" variant="outline" className="h-11 md:h-10" disabled={busy} onClick={onCancel}>
          Voltar
        </Button>
      </div>
    </div>
  );
}

function Pilula({
  ativa,
  disabled,
  onClick,
  children,
}: {
  readonly ativa: boolean;
  readonly disabled: boolean;
  readonly onClick: () => void;
  readonly children: ReactNode;
}): ReactNode {
  return (
    <button
      type="button"
      disabled={disabled}
      aria-pressed={ativa}
      onClick={onClick}
      className={cn(
        "inline-flex h-11 items-center rounded-full border px-4 text-sm font-semibold transition-colors md:h-10",
        ativa ? "border-primary bg-accent text-accent-foreground" : "bg-muted",
        disabled && "cursor-not-allowed opacity-50",
      )}
    >
      {children}
    </button>
  );
}
