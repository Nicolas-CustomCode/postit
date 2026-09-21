"use client";

import { ImagePlus, Images, Plus } from "lucide-react";
import type { ReactNode } from "react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

/**
 * O quadrado que fecha a faixa de miniaturas, e as duas portas de mídia.
 *
 * Substituiu dois botões soltos abaixo da faixa. Como quadrado pontilhado do
 * mesmo tamanho das miniaturas, ele é o **próximo lugar** — que é literalmente o
 * que ele é —, em vez de um controle solto sem relação visual com elas.
 *
 * Some quando o formato já está cheio (dez no Feed, uma em Stories): é o mesmo
 * "some quando não cabe mais" que os dois botões faziam.
 */
export function AddMediaTile({
  disabled,
  onPickLibrary,
  onPickNew,
}: {
  readonly disabled: boolean;
  readonly onPickLibrary: () => void;
  readonly onPickNew: () => void;
}): ReactNode {
  return (
    /*
     * ⚠️ **`modal={false}` não é enfeite.** O menu modal do Radix escreve
     * `pointer-events: none` no `<body>` e o limpa ao fechar; abrindo o diálogo
     * do acervo no mesmo instante, a limpeza do menu apaga a trava do diálogo —
     * ou a deixa para trás e a página inteira para de responder ao clique.
     */
    <DropdownMenu modal={false}>
      <DropdownMenuTrigger asChild disabled={disabled}>
        <button
          type="button"
          className="flex size-28 flex-col items-center justify-center gap-1 rounded-xl border-2 border-dashed bg-muted text-muted-foreground transition-colors hover:border-primary hover:bg-accent hover:text-accent-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none disabled:opacity-50"
        >
          <Plus className="size-6" aria-hidden />
          <span className="text-[13px] font-semibold">
            Adicionar
            {/* O nome acessível é lido fora do contexto da faixa, e "Adicionar"
                sozinho não diz o quê. */}
            <span className="sr-only"> imagem</span>
          </span>
        </button>
      </DropdownMenuTrigger>

      <DropdownMenuContent
        align="start"
        className="w-52"
        /*
         * ⚠️ Sem isto, ao fechar o menu devolve o foco ao gatilho — e arranca o
         * foco do diálogo que acabou de abrir, que então não recebe nem o
         * Escape. É o defeito conhecido do Radix com menu e diálogo juntos.
         */
        onCloseAutoFocus={(evento) => evento.preventDefault()}
      >
        <DropdownMenuItem className="h-11 gap-2.5 px-3 text-[15px] md:h-10 md:text-sm" onSelect={onPickLibrary}>
          <Images aria-hidden />
          Do acervo
        </DropdownMenuItem>
        {/*
          ⚠️ `onSelect` roda **síncrono** dentro do clique, então o
          `input.click()` lá dentro ainda está na ativação do usuário e o
          navegador abre o seletor. Adiar com `setTimeout` funcionaria no Chrome
          por sorte — a ativação dura alguns segundos — e falharia no Safari.
        */}
        <DropdownMenuItem className="h-11 gap-2.5 px-3 text-[15px] md:h-10 md:text-sm" onSelect={onPickNew}>
          <ImagePlus aria-hidden />
          Enviar nova
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
