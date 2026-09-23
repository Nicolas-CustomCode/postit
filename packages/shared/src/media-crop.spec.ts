import { cropAxis, cropRect, fitFrame, letterboxedInCarousel, targetRatioFor, FIT_MAX_WIDTH } from "./media-crop";
import { IMAGE_SPECS, ratioFits } from "./media-formats";

/**
 * O recorte para caber num formato (RF-B02, RF-B03).
 *
 * O caso que motiva tudo: foto de celular em pé, 3024×4032. Ela é 3:4 e o feed
 * aceita no máximo 4:5 — sem recorte, a foto mais comum que existe não cabe lá.
 */
describe("recorte por formato", () => {
  const CELULAR_EM_PE = { width: 3024, height: 4032 };
  const FEED = IMAGE_SPECS.FEED;

  describe("targetRatioFor — precisa recortar?", () => {
    it("não mexe no que já cabe", () => {
      expect(targetRatioFor(1080, 1080, FEED)).toBeNull();
      expect(targetRatioFor(1080, 1350, FEED)).toBeNull(); // exatamente 4:5
      expect(targetRatioFor(4032, 3024, FEED)).toBeNull(); // paisagem 4:3
    });

    it("foto em pé vira 4:5, a proporção mais próxima", () => {
      expect(targetRatioFor(CELULAR_EM_PE.width, CELULAR_EM_PE.height, FEED)).toBeCloseTo(0.8);
    });

    it("panorâmica vira 1.91:1", () => {
      expect(targetRatioFor(4000, 1000, FEED)).toBeCloseTo(1.91);
    });

    it("medida inválida não vira recorte", () => {
      expect(targetRatioFor(0, 100, FEED)).toBeNull();
      expect(targetRatioFor(100, 0, FEED)).toBeNull();
    });

    /*
     * O defeito que esta parte corrige: uma arte 9:16 de Stories era recortada
     * para 4:5, destruindo o formato. Stories não tem faixa obrigatória, então
     * não há o que recortar.
     */
    it("formato sem faixa não recorta nada", () => {
      expect(targetRatioFor(1080, 1920, IMAGE_SPECS.STORIES)).toBeNull();
      expect(targetRatioFor(4000, 1000, IMAGE_SPECS.STORIES)).toBeNull();
    });
  });

  describe("cropRect — o retângulo que sobra", () => {
    it("na foto em pé, mantém a largura inteira e corta a altura", () => {
      const r = cropRect(CELULAR_EM_PE.width, CELULAR_EM_PE.height, 0.8);

      expect(r.width).toBe(3024);
      expect(r.height).toBe(3780); // 3024 / 0.8
      expect(r.height).toBeLessThan(CELULAR_EM_PE.height);
    });

    it("o resultado tem a proporção pedida", () => {
      for (const [w, h, ratio] of [
        [3024, 4032, 0.8],
        [4000, 1000, 1.91],
        [1000, 3000, 0.8],
      ] as const) {
        const r = cropRect(w, h, ratio);
        expect(r.width / r.height).toBeCloseTo(ratio, 2);
      }
    });

    /*
     * A posição é o que impede de cortar a cabeça de alguém: numa foto em pé, o
     * assunto costuma estar em cima.
     */
    it("a posição escolhe a faixa que sobrevive", () => {
      const { width: w, height: h } = CELULAR_EM_PE;

      expect(cropRect(w, h, 0.8, 0).y).toBe(0);
      expect(cropRect(w, h, 0.8, 1).y).toBe(h - 3780);
      expect(cropRect(w, h, 0.8, 0.5).y).toBe(Math.round((h - 3780) / 2));
    });

    it("posição fora de 0 a 1 é presa no limite, em vez de sair da imagem", () => {
      const { width: w, height: h } = CELULAR_EM_PE;

      expect(cropRect(w, h, 0.8, -3)).toEqual(cropRect(w, h, 0.8, 0));
      expect(cropRect(w, h, 0.8, 9)).toEqual(cropRect(w, h, 0.8, 1));
    });

    it("o retângulo nunca sai da imagem", () => {
      for (const [w, h, ratio, pos] of [
        [3024, 4032, 0.8, 0],
        [3024, 4032, 0.8, 1],
        [4000, 1000, 1.91, 0],
        [4000, 1000, 1.91, 1],
      ] as const) {
        const r = cropRect(w, h, ratio, pos);
        expect(r.x).toBeGreaterThanOrEqual(0);
        expect(r.y).toBeGreaterThanOrEqual(0);
        expect(r.x + r.width).toBeLessThanOrEqual(w);
        expect(r.y + r.height).toBeLessThanOrEqual(h);
      }
    });
  });

  describe("cropAxis — para onde o controle desliza", () => {
    it("foto em pé corta na vertical; panorâmica, na horizontal", () => {
      expect(cropAxis(3024, 4032, 0.8)).toBe("vertical");
      expect(cropAxis(4000, 1000, 1.91)).toBe("horizontal");
    });
  });

  /**
   * A saída que o corte não dá: a imagem inteira dentro de uma moldura da
   * proporção certa, com barras nas sobras (ADR 0025).
   */
  describe("fitFrame — a moldura que cabe a imagem inteira", () => {
    it("o que já cabe não vira moldura", () => {
      expect(fitFrame(1080, 1080, FEED)).toBeNull();
      expect(fitFrame(1080, 1350, FEED)).toBeNull(); // exatamente 4:5
      expect(fitFrame(4032, 3024, FEED)).toBeNull();
    });

    it("formato sem faixa não emoldura nada", () => {
      expect(fitFrame(1080, 1920, IMAGE_SPECS.STORIES)).toBeNull();
      expect(fitFrame(4000, 1000, IMAGE_SPECS.STORIES)).toBeNull();
    });

    it("medida degenerada não vira moldura", () => {
      expect(fitFrame(0, 100, FEED)).toBeNull();
      expect(fitFrame(100, 0, FEED)).toBeNull();
    });

    /*
     * ⚠️ O eixo é o oposto do corte: nesta mesma foto o recorte mexe na
     * vertical, e a moldura aparece nas laterais.
     */
    it("foto em pé ganha barra nas laterais, e a altura fica intacta", () => {
      const moldura = fitFrame(CELULAR_EM_PE.width, CELULAR_EM_PE.height, FEED);

      expect(moldura).not.toBeNull();
      expect(moldura).toMatchObject({ width: 1440, height: 1800 });
      expect(moldura!.image.y).toBe(0);
      expect(moldura!.image.height).toBe(1800);
      expect(moldura!.image.x).toBeGreaterThan(0);
    });

    it("panorâmica ganha barra em cima e embaixo", () => {
      const moldura = fitFrame(4000, 1000, FEED);

      expect(moldura).not.toBeNull();
      expect(moldura!.image.x).toBe(0);
      expect(moldura!.image.y).toBeGreaterThan(0);
      expect(moldura!.width).toBeLessThanOrEqual(FIT_MAX_WIDTH);
    });

    it("abaixo do teto, a moldura preserva os pixels do original", () => {
      const moldura = fitFrame(1000, 1400, FEED);

      expect(moldura).toEqual({
        width: 1120,
        height: 1400,
        image: { x: 60, y: 0, width: 1000, height: 1400 },
      });
    });

    it("a imagem nunca vaza da moldura", () => {
      for (const [largura, altura] of MEDIDAS_FORA_DA_FAIXA) {
        const moldura = fitFrame(largura, altura, FEED)!;

        expect(moldura.image.x).toBeGreaterThanOrEqual(0);
        expect(moldura.image.y).toBeGreaterThanOrEqual(0);
        expect(moldura.image.x + moldura.image.width).toBeLessThanOrEqual(moldura.width);
        expect(moldura.image.y + moldura.image.height).toBeLessThanOrEqual(moldura.height);
      }
    });

    /*
     * ⚠️ **O teste que paga o arquivo inteiro.** A moldura existe para caber na
     * faixa; devolver uma que não cabe é o único jeito de ela ser inútil.
     *
     * O caso que separa `Math.ceil` de `Math.round` é **700×1003**: a moldura
     * sai 803×1003 com `ceil` e 802×1003 com `round`, e 802×5 = 4010 é menor que
     * 1003×4 = 4012 — um pixel fora da faixa. Tem de ser uma medida **abaixo do
     * teto de 1440**: acima dele a largura é recalculada e o arredondamento de
     * antes se perde, então um caso grande passaria com os dois.
     */
    it("toda moldura cabe na faixa do formato", () => {
      for (const [largura, altura] of MEDIDAS_FORA_DA_FAIXA) {
        const moldura = fitFrame(largura, altura, FEED)!;

        expect(ratioFits(moldura.width, moldura.height, FEED)).toBe(true);
      }
    });
  });
});

/** Medidas que **não** cabem no feed, das comuns às cruéis com arredondamento. */
const MEDIDAS_FORA_DA_FAIXA: readonly (readonly [number, number])[] = [
  [3024, 4032], // foto de celular em pé, 3:4
  [1080, 1920], // arte de Stories, 9:16
  [700, 1003], // ⚠️ o caso em que `Math.round` erra por um pixel — ver abaixo
  [2252, 3003],
  [1000, 1400],
  [999, 1399],
  [4000, 1000], // panorâmica 4:1
  [4001, 1000],
  [320, 1000],
  [5000, 400],
  [1080, 1351], // um pixel além de 4:5 — 1080×5 = 5400 < 1351×4 = 5404
];

/**
 * O quadro do carrossel (docs/08, observado em 23/09/2026): o da primeira foto, com as
 * outras inteiras e faixas pretas onde sobra.
 */
describe("letterboxedInCarousel", () => {
  const PAISAGEM = { width: 678, height: 452 }; // 3:2, a do carrossel de teste

  it("a mesma proporção não ganha faixa, em qualquer tamanho", () => {
    expect(letterboxedInCarousel(PAISAGEM, { width: 1080, height: 720 })).toBe(false);
    expect(letterboxedInCarousel({ width: 1080, height: 1350 }, { width: 2160, height: 2700 })).toBe(false);
  });

  it("a quadrada num quadro 3:2 sai com faixas — o caso que publicamos", () => {
    expect(letterboxedInCarousel(PAISAGEM, { width: 447, height: 447 })).toBe(true);
  });

  it("um pixel de diferença não conta", () => {
    expect(letterboxedInCarousel({ width: 1080, height: 1350 }, { width: 1080, height: 1351 })).toBe(false);
  });

  /*
   * O que a tolerância existe para garantir: a foto que a pessoa acabou de recortar
   * na proporção da primeira não continua avisando.
   */
  it.each([
    [{ width: 678, height: 452 }, { width: 447, height: 447 }],
    [{ width: 1080, height: 1350 }, { width: 3024, height: 4032 }],
    [{ width: 1080, height: 1350 }, { width: 1999, height: 1001 }],
    [{ width: 1911, height: 1000 }, { width: 1537, height: 1025 }],
  ])("recortada por cropRect na razão da primeira (%j ← %j), fica sem faixa", (quadro, foto) => {
    const recorte = cropRect(foto.width, foto.height, quadro.width / quadro.height);
    expect(letterboxedInCarousel(quadro, recorte)).toBe(false);
  });
});
