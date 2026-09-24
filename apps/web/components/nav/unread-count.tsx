"use client";

import { usePathname } from "next/navigation";
import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
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
 * ⚠️ **E também a cada troca de tela, e quando quem lê pede.** Contar com a
 * revalidação do layout depois de marcar como lido não bastou: o selo continuava
 * com o número antigo até a consulta seguinte (24/09/2026). Abrir um aviso — pelo
 * sino ou pelo toque no push — sempre navega, e a troca de tela reconsulta; marcar
 * todos não navega, e a lista chama `refresh` ao terminar.
 */
const INTERVALO_MS = 60_000;

interface UnreadCountValue {
  readonly count: number;
  /** Pergunta o número de novo, agora — depois de uma ação que marcou avisos como lidos. */
  readonly refresh: () => Promise<void>;
}

const UnreadCountContext = createContext<UnreadCountValue>({ count: 0, refresh: () => Promise.resolve() });

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

  const vivo = useRef(true);
  const refresh = useCallback(async (): Promise<void> => {
    if (document.visibilityState !== "visible") return;
    const numero = await unreadCountAction();
    if (vivo.current && numero !== null) setCount(numero);
  }, []);

  useEffect(() => {
    vivo.current = true;
    const timer = window.setInterval(() => void refresh(), INTERVALO_MS);
    const aoVoltar = () => void refresh();
    window.addEventListener("focus", aoVoltar);
    document.addEventListener("visibilitychange", aoVoltar);

    return () => {
      vivo.current = false;
      window.clearInterval(timer);
      window.removeEventListener("focus", aoVoltar);
      document.removeEventListener("visibilitychange", aoVoltar);
    };
  }, [refresh]);

  // A cada troca de tela, menos a primeira carga, que já veio com a semente do layout.
  const pathname = usePathname();
  const primeiraTela = useRef(true);
  useEffect(() => {
    if (primeiraTela.current) {
      primeiraTela.current = false;
      return;
    }
    void refresh();
  }, [pathname, refresh]);

  return <UnreadCountContext value={{ count, refresh }}>{children}</UnreadCountContext>;
}

export function useUnreadCount(): number {
  return useContext(UnreadCountContext).count;
}

/** Para quem acabou de marcar avisos como lidos sem trocar de tela: o selo acompanha na hora. */
export function useRefreshUnreadCount(): () => Promise<void> {
  return useContext(UnreadCountContext).refresh;
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
