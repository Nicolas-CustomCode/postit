"use client";

import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { unreadCountAction } from "@/lib/actions/notifications";
import { cn } from "@/lib/utils";

/**
 * O número do sino, para a barra lateral e a barra inferior (RF-J01).
 *
 * A semente vem do layout autenticado. Sozinha ela envelheceria: o layout não
 * roda de novo na navegação (regra 25), e o aviso que o worker grava — uma
 * publicação que falhou às 3h — não chegaria a uma tela já aberta. Por isso a
 * consulta: **a cada 60 s e ao voltar para a aba**, e nunca com a aba escondida.
 *
 * Quando uma ação revalida o layout (abrir um aviso, marcar todos), a semente
 * nova chega e substitui o número na hora.
 */
const INTERVALO_MS = 60_000;

const UnreadCountContext = createContext(0);

export function UnreadCountProvider({
  initial,
  children,
}: {
  readonly initial: number;
  readonly children: ReactNode;
}): ReactNode {
  const [count, setCount] = useState(initial);
  const [semente, setSemente] = useState(initial);

  // Semente nova do layout vence o que a consulta tinha: é o dado mais recente.
  if (initial !== semente) {
    setSemente(initial);
    setCount(initial);
  }

  useEffect(() => {
    let vivo = true;

    async function consultar(): Promise<void> {
      if (document.visibilityState !== "visible") return;
      const numero = await unreadCountAction();
      if (vivo && numero !== null) setCount(numero);
    }

    const timer = window.setInterval(() => void consultar(), INTERVALO_MS);
    const aoVoltar = () => void consultar();
    window.addEventListener("focus", aoVoltar);
    document.addEventListener("visibilitychange", aoVoltar);

    return () => {
      vivo = false;
      window.clearInterval(timer);
      window.removeEventListener("focus", aoVoltar);
      document.removeEventListener("visibilitychange", aoVoltar);
    };
  }, []);

  return <UnreadCountContext value={count}>{children}</UnreadCountContext>;
}

export function useUnreadCount(): number {
  return useContext(UnreadCountContext);
}

/**
 * O selo do sino: a lima dos "contadores novos" do docs/13, com números
 * tabulares. Some com zero.
 *
 * O número visível é `aria-hidden`, e o leitor de tela ouve a frase inteira pelo
 * `sr-only` — "3" solto ao lado de "Notificações" não diz o que conta.
 */
export function UnreadBadge({ count, className }: { readonly count: number; readonly className?: string }): ReactNode {
  if (count <= 0) return null;

  return (
    <>
      <span
        aria-hidden
        className={cn(
          "inline-flex h-4.5 min-w-4.5 items-center justify-center rounded-full bg-highlight px-1 text-[11px] leading-none font-bold text-highlight-foreground tabular-nums",
          className,
        )}
      >
        {count > 9 ? "9+" : count}
      </span>
      <span className="sr-only">({count === 1 ? "1 não lida" : `${count} não lidas`})</span>
    </>
  );
}
