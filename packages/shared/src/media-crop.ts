import { ratioFits, type ImageSpec } from "./media-formats";

/**
 * As duas formas de fazer uma imagem caber na proporção de **um formato**
 * (RF-B02, RF-B03).
 *
 * **Por que isto existe.** Foto de celular tirada em pé é 3:4, e a API do
 * Instagram só aceita de 4:5 a 1.91:1 no feed — ou seja, a foto mais comum que
 * existe é recusada. O aplicativo aceita 3:4 desde 2025 e corta sozinho; a API
 * não acompanhou (docs/08). Aqui a pessoa vê o que vai acontecer e escolhe.
 *
 * **Duas operações duais**, e é o que organiza este arquivo:
 *
 * | | `cropRect` | `fitFrame` |
 * |---|---|---|
 * | O que faz | **tira** pixels no eixo que sobra | **acrescenta** moldura no eixo que falta |
 * | O que preserva | um lado inteiro | **os dois lados** da imagem |
 * | Efeito no arquivo | sempre encolhe a área | sempre aumenta |
 *
 * ⚠️ **Os eixos são opostos, e isso confunde.** Numa foto em pé indo para o
 * feed, o **corte** mexe na vertical e a **moldura** aparece nas laterais.
 * `cropAxis` responde pelo corte; para a moldura, olhe `layout.image.x > 0`.
 *
 * ⚠️ **A faixa vem por parâmetro, não de uma constante.** Cada formato tem a
 * sua, e Stories não tem nenhuma: recortar contra a faixa do feed uma imagem que
 * ia para Stories destruiria justamente o formato que a pessoa queria.
 *
 * Regra pura, sem navegador: recebe medidas e devolve retângulos. Quem desenha
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

/**
 * Onde a moldura para de crescer.
 *
 * ⚠️ **Não é limite de validação.** A largura máxima nunca é validada (docs/08,
 * "Como o validador trata estas tabelas") — a Meta redimensiona sozinha acima de
 * 1440. Este teto existe por outro motivo: a moldura é a **única operação que
 * aumenta** a imagem, e sem ele um panorama grande viraria um JPEG acima dos
 * 8 MB da própria política de envio.
 */
export const FIT_MAX_WIDTH = 1440;

export interface FitLayout {
  /** A moldura final, em pixels. */
  readonly width: number;
  readonly height: number;
  /** Onde a imagem entra dentro dela, já escalada e centrada. */
  readonly image: CropRect;
}

/**
 * A moldura que cabe a imagem **inteira** na faixa do formato, com barras nas
 * sobras. `null` quando não há o que emoldurar — já cabe, o formato não tem
 * faixa, ou a medida é degenerada.
 *
 * É a saída que o corte não dá: uma arte 9:16 chega ao feed sem perder nada.
 * ⚠️ **É invenção nossa, não fidelidade ao aplicativo** — o Instagram recorta e
 * não põe borda; quem quer a arte inteira usa app de borda antes (ADR 0025).
 *
 * ⚠️ **Recebe `ImageSpec` e decide em aritmética inteira**, a mesma de
 * `ratioFits`. Receber um `number` como `cropRect` abriria uma terceira
 * aritmética para a mesma pergunta — `targetRatioFor` já decide em ponto
 * flutuante — e é justamente aqui que o erro de um pixel não perdoa.
 */
export function fitFrame(
  width: number,
  height: number,
  spec: ImageSpec,
  maxWidth: number = FIT_MAX_WIDTH,
): FitLayout | null {
  if (width <= 0 || height <= 0) return null;
  if (spec.ratio === null) return null;
  if (ratioFits(width, height, spec)) return null;

  const { min, max } = spec.ratio;
  const altaDemais = width * min.height < height * min.width;

  /*
   * ⚠️ **`Math.ceil`, nunca `Math.round`.** A moldura arredonda **para fora**:
   * arredondar para dentro devolve uma moldura um pixel **fora da faixa**, que é
   * exatamente o que esta função existe para evitar. O contraexemplo está no
   * spec — 700×1003 com `round` dá 802×1003, e 802×5 = 4010 < 1003×4 = 4012.
   */
  let molduraW = altaDemais ? Math.ceil((height * min.width) / min.height) : width;
  let molduraH = altaDemais ? height : Math.ceil((width * max.height) / max.width);

  if (molduraW > maxWidth) {
    /*
     * Recalcula a altura, em vez de escalar as duas: escalar arredondaria o
     * outro lado para fora de novo. Com a largura fixa, é a **altura** que
     * precisa cair do lado certo da borda — para baixo quando o alvo é o mínimo
     * (4:5), para cima quando é o máximo (1.91:1).
     */
    molduraW = maxWidth;
    molduraH = altaDemais
      ? Math.floor((molduraW * min.height) / min.width)
      : Math.ceil((molduraW * max.height) / max.width);
  }

  // A imagem preenche o eixo que não ganhou barra e fica centrada no outro.
  const imagem = altaDemais
    ? { width: Math.round((width * molduraH) / height), height: molduraH }
    : { width: molduraW, height: Math.round((height * molduraW) / width) };

  return {
    width: molduraW,
    height: molduraH,
    image: {
      x: Math.round((molduraW - imagem.width) / 2),
      y: Math.round((molduraH - imagem.height) / 2),
      ...imagem,
    },
  };
}
