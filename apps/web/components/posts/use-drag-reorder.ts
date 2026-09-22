"use client";

import { useCallback, useEffect, useRef, useState } from "react";

/** Quanto tempo o dedo fica parado antes de o toque virar arrasto. */
const ESPERA_DO_TOQUE_MS = 250;
/** Quanto o dedo pode escorregar durante a espera sem cancelar o arrasto. */
const TOLERANCIA_PX = 10;
/** A que distância da borda a faixa começa a rolar sozinha. */
const BORDA_PX = 40;
const VELOCIDADE_PX = 8;

export interface DragState {
  /** Qual item está na mão, ou `null` quando ninguém está arrastando. */
  readonly indice: number;
  /** Para onde ele vai se for solto agora. */
  readonly destino: number;
  /** Quanto o ponteiro andou desde o início, em pixels. */
  readonly deslocamento: number;
}

/**
 * Arrastar para reordenar a faixa de miniaturas (RF-C04).
 *
 * ⚠️ **Pointer Events, e não o `draggable` do HTML5.** A API antiga não dispara
 * no toque — e este sistema vive no celular. Pointer Events cobre mouse, dedo e
 * caneta com o mesmo código, que é o que as bibliotecas de arrastar usam por
 * baixo.
 *
 * ⚠️ **Nada de biblioteca, porque o caso é o mais estreito que existe:** uma
 * linha horizontal de itens do mesmo tamanho. O destino é uma divisão, não
 * detecção de colisão. As bibliotecas são grandes porque resolvem listas
 * aninhadas, grades e arrastar entre listas — nada disso acontece aqui.
 *
 * ⚠️ **No dedo, o arrasto só começa depois de segurar.** Sem isso, rolar a faixa
 * reordenaria sem querer. É o gesto que iOS e Android já ensinaram. No mouse
 * começa na hora: o mouse não rola a faixa arrastando.
 *
 * **Reordenar de verdade não acontece aqui:** ao soltar, o hook chama o mesmo
 * `onMover` que as setas chamam. Um caminho, duas entradas.
 */
export function useDragReorder({
  total,
  onMover,
  disabled,
}: {
  readonly total: number;
  readonly onMover: (de: number, para: number) => void;
  readonly disabled: boolean;
}): {
  readonly drag: DragState | null;
  readonly containerRef: React.RefObject<HTMLUListElement | null>;
  readonly handlers: (indice: number) => {
    onPointerDown: (evento: React.PointerEvent<HTMLElement>) => void;
  };
} {
  const containerRef = useRef<HTMLUListElement>(null);
  const [drag, setDrag] = useState<DragState | null>(null);

  /*
   * O que está em voo fica em `ref`, não em estado: os manipuladores de
   * `pointermove` são registrados uma vez e leriam sempre o primeiro valor se
   * dependessem de estado.
   */
  const emVoo = useRef<{
    indice: number;
    xInicial: number;
    ativo: boolean;
    pointerId: number;
    toque: boolean;
    espera: ReturnType<typeof setTimeout> | null;
  } | null>(null);
  const rolagem = useRef<number | null>(null);

  const pararRolagem = useCallback(() => {
    if (rolagem.current !== null) cancelAnimationFrame(rolagem.current);
    rolagem.current = null;
  }, []);

  const encerrar = useCallback(() => {
    const atual = emVoo.current;
    if (atual?.espera != null) clearTimeout(atual.espera);
    emVoo.current = null;
    pararRolagem();
    setDrag(null);
  }, [pararRolagem]);

  /** O passo entre dois itens, medido do DOM. */
  const passoDe = useCallback((lista: HTMLUListElement): number => {
    const itens = lista.querySelectorAll<HTMLElement>("[data-midia]");
    const primeiro = itens[0];
    const segundo = itens[1];
    // ⚠️ Medido, nunca escrito à mão: o tamanho vem de `rem`, e muda com o zoom
    // do navegador e com a fonte do sistema.
    if (primeiro === undefined || segundo === undefined) return 0;
    return segundo.offsetLeft - primeiro.offsetLeft;
  }, []);

  useEffect(() => {
    function mover(evento: PointerEvent): void {
      const atual = emVoo.current;
      const lista = containerRef.current;
      if (atual === null || lista === null || evento.pointerId !== atual.pointerId) return;

      const dx = evento.clientX - atual.xInicial;

      // Ainda esperando o toque virar arrasto: sair do lugar é rolagem, não
      // reordenação, e cancela.
      if (!atual.ativo) {
        if (Math.abs(dx) > TOLERANCIA_PX) encerrar();
        return;
      }

      const passo = passoDe(lista);
      const destino =
        passo === 0 ? atual.indice : Math.min(Math.max(atual.indice + Math.round(dx / passo), 0), total - 1);
      setDrag({ indice: atual.indice, destino, deslocamento: dx });

      // Perto da borda, a faixa acompanha: com dez fotos no celular só três
      // cabem na tela, e sem isto as outras seriam inalcançáveis.
      const caixa = lista.getBoundingClientRect();
      const paraEsquerda = evento.clientX < caixa.left + BORDA_PX;
      const paraDireita = evento.clientX > caixa.right - BORDA_PX;

      pararRolagem();
      if (paraEsquerda || paraDireita) {
        const passoDaRolagem = paraEsquerda ? -VELOCIDADE_PX : VELOCIDADE_PX;
        const rolar = (): void => {
          lista.scrollLeft += passoDaRolagem;
          rolagem.current = requestAnimationFrame(rolar);
        };
        rolagem.current = requestAnimationFrame(rolar);
      }
    }

    function soltar(evento: PointerEvent): void {
      const atual = emVoo.current;
      if (atual === null || evento.pointerId !== atual.pointerId) return;

      const lista = containerRef.current;
      if (atual.ativo && lista !== null) {
        const passo = passoDe(lista);
        const dx = evento.clientX - atual.xInicial;
        const destino =
          passo === 0 ? atual.indice : Math.min(Math.max(atual.indice + Math.round(dx / passo), 0), total - 1);
        if (destino !== atual.indice) onMover(atual.indice, destino);
      }

      encerrar();
    }

    /*
     * ⚠️ **A rolagem se impede no `touchmove`, não no `pointermove`.** Cancelar
     * o `pointermove` não cancela a rolagem — a especificação manda usar
     * `touch-action` ou barrar o `touchmove`, e o `touch-action` já foi decidido
     * quando o dedo encostou. Este é o listener que faz o arrasto vencer a
     * rolagem da faixa depois que o toque virou arrasto.
     *
     * No mouse **não** se faz isso: barrar o evento suprimiria o `mousemove`
     * equivalente, e quem espera por ele espera para sempre.
     */
    function segurarRolagem(evento: TouchEvent): void {
      if (emVoo.current?.ativo === true) evento.preventDefault();
    }

    window.addEventListener("pointermove", mover);
    window.addEventListener("pointerup", soltar);
    window.addEventListener("pointercancel", encerrar);
    window.addEventListener("touchmove", segurarRolagem, { passive: false });

    return () => {
      window.removeEventListener("pointermove", mover);
      window.removeEventListener("pointerup", soltar);
      window.removeEventListener("pointercancel", encerrar);
      window.removeEventListener("touchmove", segurarRolagem);
    };
  }, [encerrar, onMover, pararRolagem, passoDe, total]);

  const handlers = useCallback(
    (indice: number) => ({
      onPointerDown: (evento: React.PointerEvent<HTMLElement>): void => {
        // Só o botão principal: o direito abre menu de contexto, e o do meio cola.
        if (disabled || total < 2 || evento.button !== 0) return;

        /*
         * ⚠️ **Os controles não arrastam.** Remover e as setas moram dentro do
         * mesmo item, e sem esta guarda o `pointerdown` deles pegaria a imagem:
         * o item cresce com `scale`, o botão sai de debaixo do cursor e o clique
         * nunca acontece. Arrastar começa na foto.
         */
        if ((evento.target as HTMLElement).closest("button") !== null) return;

        const alvo = evento.currentTarget;
        alvo.setPointerCapture?.(evento.pointerId);

        const comum = {
          indice,
          xInicial: evento.clientX,
          pointerId: evento.pointerId,
          toque: evento.pointerType !== "mouse",
        };

        if (!comum.toque) {
          emVoo.current = { ...comum, ativo: true, espera: null };
          setDrag({ indice, destino: indice, deslocamento: 0 });
          return;
        }

        emVoo.current = {
          ...comum,
          ativo: false,
          espera: setTimeout(() => {
            const atual = emVoo.current;
            if (atual === null) return;
            atual.ativo = true;
            atual.espera = null;
            setDrag({ indice, destino: indice, deslocamento: 0 });
            // Onde existir, o aparelho avisa que a imagem foi pega.
            navigator.vibrate?.(10);
          }, ESPERA_DO_TOQUE_MS),
        };
      },
    }),
    [disabled, total],
  );

  return { drag, containerRef, handlers };
}
