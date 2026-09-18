import type { ImageSpec } from "./media-formats";

/**
 * O recorte que faz uma imagem caber na proporção de **um formato** (RF-B02,
 * RF-B03).
 *
 * **Por que isto existe.** Foto de celular tirada em pé é 3:4, e o feed do
 * Instagram só aceita até 4:5 — ou seja, a foto mais comum que existe seria
 * recusada. O app do Instagram corta sozinho e ninguém percebe; aqui a pessoa vê
 * o corte e escolhe o que fica dentro.
 *
 * ⚠️ **A faixa vem por parâmetro, não de uma constante.** Cada formato tem a
 * sua, e Stories não tem nenhuma: recortar contra a faixa do feed uma imagem que
 * ia para Stories destruiria justamente o formato que a pessoa queria.
 *
 * Regra pura, sem navegador: recebe medidas e devolve um retângulo. Quem desenha
 * é o componente; quem testa é o Jest.
 */

export interface CropRect {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

/** Onde o recorte fica: 0 é todo no topo (ou à esquerda), 1 é todo na base. */
export type CropPosition = number;

/**
 * Precisa recortar para caber neste formato? `null` quando já cabe como está —
 * inclusive quando o formato não tem faixa nenhuma, como Stories.
 *
 * Devolve a proporção alvo — a **mais próxima** da original, para o corte tirar
 * o mínimo possível: no feed, uma foto alta demais vira 4:5, uma larga demais
 * vira 1.91:1.
 */
export function targetRatioFor(width: number, height: number, spec: ImageSpec): number | null {
  if (height <= 0 || width <= 0) return null;
  if (spec.ratio === null) return null;

  const minimo = spec.ratio.min.width / spec.ratio.min.height;
  const maximo = spec.ratio.max.width / spec.ratio.max.height;
  const atual = width / height;

  if (atual < minimo) return minimo;
  if (atual > maximo) return maximo;
  return null;
}

/**
 * O retângulo a recortar, na proporção alvo, posicionado por `position`.
 *
 * **Mantém a maior área possível**: corta só no eixo que sobra, e preserva o
 * outro inteiro. Numa foto em pé, a largura fica intacta e a altura encolhe —
 * então `position` escolhe a faixa vertical que sobrevive, que é o que importa
 * para não decapitar ninguém.
 *
 * Os valores saem arredondados: pixel é inteiro, e o canvas trunca sozinho de um
 * jeito que pode devolver uma imagem um pixel fora da proporção pedida.
 */
export function cropRect(width: number, height: number, ratio: number, position: CropPosition = 0.5): CropRect {
  const posicao = Math.min(1, Math.max(0, position));

  // Alto demais: mantém a largura, corta a altura.
  if (width / height < ratio) {
    const alturaAlvo = Math.round(width / ratio);
    return {
      x: 0,
      y: Math.round((height - alturaAlvo) * posicao),
      width,
      height: alturaAlvo,
    };
  }

  // Largo demais: mantém a altura, corta a largura.
  const larguraAlvo = Math.round(height * ratio);
  return {
    x: Math.round((width - larguraAlvo) * posicao),
    y: 0,
    width: larguraAlvo,
    height,
  };
}

/** Em que eixo o corte acontece — é o que o controle da tela move. */
export function cropAxis(width: number, height: number, ratio: number): "vertical" | "horizontal" {
  return width / height < ratio ? "vertical" : "horizontal";
}
