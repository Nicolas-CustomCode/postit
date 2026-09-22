"use client";

import { Check, ImageOff, Loader2, Trash2 } from "lucide-react";
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
 * ⚠️ **As incompatíveis aparecem, não são escondidas.** Quem enviou uma arte
 * 9:16 e está compondo para o feed precisa **ver** que ela está lá. Escondê-la
 * faria a pessoa procurar uma foto que sabe que enviou e não achar — e concluir
 * que o envio falhou. Vale igual para a lixeira: a de uma imagem em uso fica
 * **desligada**, não sumida (RF-B07).
 *
 * Com `onAdjust`, a incompatível deixa de estar apagada e passa a ser **a porta
 * do ajuste**: clicar nela abre a tela que a recorta ou emoldura para o formato
 * (ADR 0025). Sem ele — e até 22/09/2026 era o único jeito — ela fica apagada e
 * inerte, que é o que resta quando não há saída a oferecer.
 *
 * ⚠️ **Sobrepor, nunca aninhar.** O card inteiro é um `<button>`, então lixeira
 * e caixa de seleção são **irmãs** dele, posicionadas por cima — botão dentro de
 * botão é HTML inválido. Como são irmãs, o clique numa delas não atravessa para
 * o card, e nem `stopPropagation` é preciso.
 */
export function MediaGrid({
  media,
  format,
  selectedIds,
  disabledIds,
  onSelect,
  onAdjust,
  onDelete,
  checkedIds,
  onCheck,
  deletingId,
}: {
  readonly media: readonly MediaSummary[];
  /** O formato de destino. Sem ele, a grade só mostra — não filtra nada. */
  readonly format?: ImageFormat;
  /** Uma lista, porque a composição escolhe várias de uma vez (carrossel). */
  readonly selectedIds?: readonly string[];
  /** Serve ao formato, mas não cabe agora: a postagem já chegou ao limite. */
  readonly disabledIds?: readonly string[];
  readonly onSelect?: (media: MediaSummary) => void;
  /**
   * O que fazer com uma que **não serve** ao formato (RF-B03; ADR 0025).
   *
   * Só tem sentido junto de `format`: sem formato de destino não existe
   * incompatível, e é o formato que diz para o que ajustar.
   */
  readonly onAdjust?: (media: MediaSummary) => void;
  /** A lixeira do card (RF-B07). Sem ela, a grade não apaga nada. */
  readonly onDelete?: (media: MediaSummary) => void;
  /**
   * O modo de excluir várias, do Acervo.
   *
   * ⚠️ Não confundir com `selectedIds`/`onSelect`, que são do seletor da
   * composição: lá se escolhe o que **entra** na postagem, aqui o que **sai** do
   * acervo.
   */
  readonly checkedIds?: readonly string[];
  readonly onCheck?: (media: MediaSummary, checked: boolean) => void;
  /** Qual está saindo agora: a lixeira dela gira e não aceita outro clique. */
  readonly deletingId?: string | null;
}): ReactNode {
  const modoSelecao = onCheck !== undefined;
  /*
   * Sem nenhuma das props do acervo, tudo o que vem abaixo some e o seletor da
   * composição continua byte a byte o que era.
   */
  const noAcervo = onDelete !== undefined || modoSelecao;

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
        const selecionada = selectedIds?.includes(item.id) ?? false;
        const naoCabe = disabledIds?.includes(item.id) ?? false;
        const marcada = checkedIds?.includes(item.id) ?? false;
        /*
         * No seletor da composição, `inUse` não importa: imagem em uso é
         * exatamente o que se reaproveita (RF-B04). Ela só pesa no acervo.
         */
        const presa = noAcervo && item.inUse;
        /*
         * ⚠️ **`naoCabe` vence o ajuste.** Com a postagem cheia, ajustar
         * produziria uma imagem nova que não teria onde entrar — e o arquivo já
         * estaria no acervo, enviado à toa.
         */
        const ajustavel = onAdjust !== undefined && format !== undefined && !serve && !naoCabe;
        const clicavel = modoSelecao ? !presa : ajustavel || (onSelect !== undefined && serve && !naoCabe);

        return (
          // O `group` vai no `<li>`: a lixeira é irmã do botão, não descendente
          // dele — num `group` no botão, o `group-hover` nunca dispararia.
          <li key={item.id} className="group relative">
            <button
              type="button"
              // No modo seleção o card **é** a caixa: alvo de toque do tamanho
              // do card, e nenhum controle menor dentro dele.
              role={modoSelecao ? "checkbox" : undefined}
              aria-checked={modoSelecao ? marcada : undefined}
              aria-label={noAcervo ? `Imagem de ${item.width} por ${item.height} pixels` : undefined}
              disabled={!clicavel}
              onClick={() => {
                if (modoSelecao) onCheck?.(item, !marcada);
                else if (ajustavel) onAdjust?.(item);
                else onSelect?.(item);
              }}
              className={cn(
                "flex w-full flex-col gap-1.5 rounded-xl border p-1.5 text-left transition-colors",
                clicavel && "hover:bg-muted",
                (selecionada || marcada) && "border-primary ring-2 ring-accent",
                // Apagada é "não dá": a que tem ajuste a oferecer dá, e fica inteira.
                ((!serve && !ajustavel) || naoCabe || presa) && "opacity-45",
                onSelect === undefined && !modoSelecao && "cursor-default",
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
                  {/* A frase diz o que fazer, não só o que está errado: é a
                      mesma linha, e a diferença é haver saída. */}
                  {ajustavel ? "Ajustar para " : "Não serve para "}
                  {IMAGE_SPECS[format].label}
                </span>
              )}
              {presa && <span className="px-0.5 text-[11px] text-muted-foreground">Em uso numa postagem</span>}
            </button>

            {/* Desenho, não controle: quem é a caixa é o card inteiro. */}
            {modoSelecao && (
              <span
                aria-hidden
                className={cn(
                  "pointer-events-none absolute top-2.5 left-2.5 flex size-6 items-center justify-center rounded-md border-2 bg-card/90 shadow-sm",
                  marcada ? "border-primary bg-primary text-primary-foreground" : "border-border",
                )}
              >
                {marcada && <Check className="size-4" strokeWidth={3} />}
              </span>
            )}

            {/* No modo seleção a lixeira some: um gesto destrutivo por card. */}
            {onDelete !== undefined && !modoSelecao && (
              <button
                type="button"
                disabled={item.inUse || deletingId === item.id}
                onClick={() => onDelete(item)}
                aria-label={`Excluir a imagem de ${item.width} por ${item.height} pixels`}
                className={cn(
                  // 44 px de alvo, 32 px de desenho (docs/13, Acessibilidade).
                  "absolute top-0.5 right-0.5 inline-flex size-11 items-center justify-center transition-opacity",
                  /*
                   * ⚠️ `pointer-fine` é o ponteiro preciso — mouse e trackpad.
                   * No toque **não existe hover**, e este projeto vive no
                   * celular: lá o botão fica sempre à mão. Um `md:` aqui o
                   * esconderia num aparelho sem cursor nenhum, como o tablet.
                   *
                   * ⚠️ `group-focus-within` não é enfeite: sem ele a lixeira é
                   * invisível e inalcançável por teclado no computador.
                   */
                  "pointer-fine:opacity-0 pointer-fine:group-hover:opacity-100 pointer-fine:group-focus-within:opacity-100",
                )}
              >
                <span
                  className={cn(
                    "flex size-8 items-center justify-center rounded-md border bg-card/90 shadow-sm",
                    item.inUse && "border-dashed",
                  )}
                >
                  {deletingId === item.id ? (
                    <Loader2 className="size-4 animate-spin text-muted-foreground" aria-hidden />
                  ) : (
                    <Trash2
                      className={cn("size-4", item.inUse ? "text-muted-foreground" : "text-destructive")}
                      aria-hidden
                    />
                  )}
                </span>
              </button>
            )}
          </li>
        );
      })}
    </ul>
  );
}
