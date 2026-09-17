"use client";

import { RotateCcw } from "lucide-react";
import Link from "next/link";
import { useEffect, type ReactNode } from "react";
import { Button } from "@/components/ui/button";

/**
 * A rede de segurança das telas de dentro.
 *
 * Sem ela, qualquer exceção durante o render apaga a tela inteira — fundo
 * branco, sem texto, sem botão. A pessoa não tem o que fazer além de fechar.
 *
 * ⚠️ **Nunca mostra o erro.** O `error` chega ao navegador, e no servidor ele
 * pode ter sido montado com o que estava em volta — endereço de chamada,
 * resposta de API, e daí a segredo é um passo (AGENTS.md, regra 3). O que a
 * pessoa recebe é o `digest`, que é só um identificador: serve para cruzar com
 * o log do servidor, e não diz nada sozinho.
 */
export default function ErroNaCasca({
  error,
  reset,
}: {
  readonly error: Error & { digest?: string };
  readonly reset: () => void;
}): ReactNode {
  useEffect(() => {
    // Vai para o console do navegador, não para a tela. Em desenvolvimento é o
    // que permite ver a pilha; em produção, o Next já reduz a mensagem.
    console.error("Erro na casca autenticada", error);
  }, [error]);

  return (
    <main className="mx-auto flex w-full max-w-md flex-1 flex-col justify-center gap-4 px-4 py-10 text-center">
      <h1 className="font-heading text-[26px] font-extrabold tracking-[-0.02em]">Algo deu errado nesta tela</h1>
      <p className="text-muted-foreground">
        O PostIt continua no ar e nada do seu trabalho se perdeu. Tente de novo; se insistir, vá para as contas e
        entre de novo na tela.
      </p>

      <div className="mt-2 flex flex-col gap-2 sm:flex-row sm:justify-center">
        <Button onClick={reset} className="h-11 md:h-10">
          <RotateCcw className="size-4.5" strokeWidth={2} aria-hidden />
          Tentar de novo
        </Button>
        <Button asChild variant="secondary" className="h-11 md:h-10">
          <Link href="/contas">Ir para as contas</Link>
        </Button>
      </div>

      {error.digest === undefined ? null : (
        <p className="text-xs text-muted-foreground tabular-nums">
          Código para o suporte: <span className="font-mono">{error.digest}</span>
        </p>
      )}
    </main>
  );
}
