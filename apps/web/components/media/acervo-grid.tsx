"use client";

import { CheckSquare, Trash2 } from "lucide-react";
import { useState, useTransition, type ReactNode } from "react";
import type { MediaSummary } from "@repo/shared";
import { MediaGrid } from "@/components/media/media-grid";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { deleteMediaAction } from "@/lib/actions/media";
import { cn } from "@/lib/utils";

/**
 * O acervo com o que dá para fazer nele (RF-B04, RF-B07).
 *
 * **Dois gestos, uma confirmação.** A lixeira do card apaga direto — é uma
 * imagem, o alvo é pequeno e passar o cursor até ele já é deliberado. O
 * "Excluir N" do modo seleção pergunta antes, porque um clique errado ali leva
 * várias de uma vez.
 *
 * ⚠️ **A confirmação é uma folha, e não um segundo estado da barra.** Na barra,
 * o "Excluir 8" e o "Confirmar" cairiam no mesmo pixel: dois cliques rápidos
 * apagariam oito imagens, que é exatamente o acidente que a confirmação existe
 * para evitar.
 */
export function AcervoGrid({ media }: { readonly media: readonly MediaSummary[] }): ReactNode {
  const [selecionando, setSelecionando] = useState(false);
  const [marcadas, setMarcadas] = useState<readonly string[]>([]);
  const [confirmando, setConfirmando] = useState(false);
  const [apagando, setApagando] = useState<string | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [pendente, comTransicao] = useTransition();

  function sairDoModo(): void {
    setSelecionando(false);
    // Marcação que sobrevive ao modo vira exclusão que ninguém pediu — mesma
    // razão do seletor do carrossel zerar os pendentes ao fechar.
    setMarcadas([]);
    setConfirmando(false);
  }

  async function excluir(ids: readonly string[]): Promise<void> {
    setErro(null);
    const resultado = await deleteMediaAction(ids);

    if (!resultado.ok) {
      setErro(resultado.message);
      return;
    }
    sairDoModo();
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between gap-3">
        <h2 className="font-heading text-lg font-bold">
          No acervo {media.length > 0 && <span className="text-muted-foreground">({media.length})</span>}
        </h2>
        {media.length > 0 && !selecionando && (
          <Button
            type="button"
            variant="outline"
            className="h-11 gap-2 md:h-10"
            onClick={() => setSelecionando(true)}
          >
            <CheckSquare className="size-4" aria-hidden />
            Selecionar
          </Button>
        )}
      </div>

      {erro !== null && (
        <Alert variant="destructive" role="alert">
          <AlertDescription>
            {erro} Descarte ou cancele as postagens que a usam. Imagem de postagem publicada não sai — o
            histórico não se apaga.
          </AlertDescription>
        </Alert>
      )}

      <MediaGrid
        media={media}
        onDelete={
          selecionando
            ? undefined
            : (item) => {
                setApagando(item.id);
                comTransicao(async () => {
                  await excluir([item.id]);
                  setApagando(null);
                });
              }
        }
        deletingId={apagando}
        checkedIds={selecionando ? marcadas : undefined}
        onCheck={
          selecionando
            ? (item, marcada) =>
                setMarcadas((atual) =>
                  marcada ? [...atual, item.id] : atual.filter((id) => id !== item.id),
                )
            : undefined
        }
      />

      {selecionando && (
        // Grudada no rodapé no celular, na linha do conteúdo no computador —
        // a mesma receita da barra de ações da composição.
        <div
          className={cn(
            "sticky bottom-0 -mx-4 flex items-center gap-3 border-t bg-background px-4 pt-3",
            "pb-[calc(0.75rem+env(safe-area-inset-bottom))]",
            "md:static md:mx-0 md:border-0 md:bg-transparent md:p-0",
          )}
        >
          <p className="flex-1 text-sm font-medium tabular-nums">
            {marcadas.length === 1 ? "1 imagem selecionada" : `${marcadas.length} imagens selecionadas`}
          </p>
          <Button type="button" variant="outline" className="h-11 md:h-10" onClick={sairDoModo}>
            Cancelar
          </Button>
          <Button
            type="button"
            variant="destructive"
            className="h-11 gap-2 md:h-10"
            disabled={marcadas.length === 0 || pendente}
            onClick={() => setConfirmando(true)}
          >
            <Trash2 className="size-4" aria-hidden />
            {marcadas.length <= 1 ? "Excluir" : `Excluir ${marcadas.length}`}
          </Button>
        </div>
      )}

      <Sheet open={confirmando} onOpenChange={setConfirmando}>
        <SheetContent
          role="alertdialog"
          side="bottom"
          className={cn(
            "rounded-t-2xl",
            "md:top-1/2 md:right-auto md:bottom-auto md:left-1/2 md:w-full md:max-w-md",
            "md:-translate-x-1/2 md:-translate-y-1/2 md:rounded-2xl md:border",
          )}
        >
          <SheetHeader>
            <SheetTitle className="font-heading">
              {marcadas.length === 1 ? "Excluir esta imagem?" : `Excluir ${marcadas.length} imagens?`}
            </SheetTitle>
            <SheetDescription>
              Elas saem do acervo e do armazenamento. Não dá para desfazer.
            </SheetDescription>
          </SheetHeader>

          <div
            className={cn(
              "flex flex-col gap-2 px-4 pb-[calc(1.5rem+env(safe-area-inset-bottom))]",
              "md:flex-row md:justify-end md:pb-6",
            )}
          >
            <Button
              type="button"
              variant="outline"
              className="h-11 md:h-10"
              onClick={() => setConfirmando(false)}
            >
              Cancelar
            </Button>
            <Button
              type="button"
              variant="destructive"
              className="h-11 md:h-10"
              disabled={pendente}
              onClick={() => comTransicao(() => excluir(marcadas))}
            >
              {pendente
                ? "Excluindo…"
                : marcadas.length === 1
                  ? "Excluir imagem"
                  : `Excluir ${marcadas.length} imagens`}
            </Button>
          </div>
        </SheetContent>
      </Sheet>
    </div>
  );
}
