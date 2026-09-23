"use client";

import { useLayoutEffect, useRef, type ReactNode } from "react";
import { captionTokens } from "@repo/shared";
import { cn } from "@/lib/utils";

/**
 * O campo da legenda, com hashtags e menções destacadas enquanto se digita.
 *
 * **Como:** um espelho atrás do `textarea`, com a mesma fonte, o mesmo recuo e a
 * mesma quebra de linha, que pinta só o **fundo** de cada `#hashtag` e `@menção`.
 * O texto que se vê — e o cursor, a seleção, o corretor — continua sendo o do
 * `textarea`, transparente por cima. Por isso o campo segue um campo de verdade
 * para leitor de tela, colar e desfazer.
 *
 * ⚠️ **O campo cresce com o texto, em vez de rolar.** Uma barra de rolagem roubaria
 * largura só do `textarea`, e as linhas do espelho quebrariam em outro lugar — o
 * destaque sairia do lugar da palavra.
 *
 * O que é hashtag e o que é menção sai de `captionTokens`, com as mesmas regras do
 * contador: `contato@empresa.com` não se pinta, porque não se conta.
 */
export function CaptionField({
  id,
  value,
  disabled,
  onChange,
}: {
  readonly id: string;
  readonly value: string;
  readonly disabled: boolean;
  readonly onChange: (value: string) => void;
}): ReactNode {
  const campo = useRef<HTMLTextAreaElement>(null);

  // Antes da pintura: medir depois deixaria um quadro com a altura velha.
  useLayoutEffect(() => {
    const textarea = campo.current;
    if (textarea === null) return;
    textarea.style.height = "auto";
    textarea.style.height = `${textarea.scrollHeight}px`;
  }, [value]);

  // O que as duas camadas dividem, para as linhas caírem no mesmo lugar.
  const tipografia = "px-3.5 py-3 text-[15px]/relaxed break-words whitespace-pre-wrap";

  return (
    <div className="relative">
      <div
        aria-hidden
        className={cn(tipografia, "pointer-events-none absolute inset-0 border border-transparent text-transparent")}
      >
        {captionTokens(value).map((pedaco, indice) =>
          pedaco.kind === "text" ? (
            pedaco.text
          ) : (
            <mark
              key={indice}
              className={cn(
                "rounded-[4px] text-transparent",
                // As cores do docs/13, que têm par no tema escuro.
                pedaco.kind === "hashtag"
                  ? "bg-accent shadow-[0_0_0_2px_var(--accent)]"
                  : "bg-[var(--status-aprovado-bg)] shadow-[0_0_0_2px_var(--status-aprovado-bg)]",
              )}
            >
              {pedaco.text}
            </mark>
          ),
        )}
        {/* O espelho ignora a última quebra de linha; o espaço a segura. */}{" "}
      </div>

      <textarea
        ref={campo}
        id={id}
        value={value}
        disabled={disabled}
        onChange={(evento) => onChange(evento.target.value)}
        rows={7}
        className={cn(
          tipografia,
          "relative block min-h-33 w-full resize-none overflow-hidden rounded-[10px] border bg-transparent focus-visible:border-primary focus-visible:ring-4 focus-visible:ring-accent focus-visible:outline-none",
        )}
        placeholder="O que vai junto com a imagem"
      />
    </div>
  );
}
