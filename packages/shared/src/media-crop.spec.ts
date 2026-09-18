import { cropAxis, cropRect, targetRatioFor } from "./media-crop";
import { IMAGE_SPECS } from "./media-formats";

/**
 * O recorte para caber num formato (RF-B02, RF-B03).
 *
 * O caso que motiva tudo: foto de celular em pé, 3024×4032. Ela é 3:4 e o feed
 * aceita no máximo 4:5 — sem recorte, a foto mais comum que existe não cabe lá.
 */
describe("recorte por formato", () => {
  const CELULAR_EM_PE = { width: 3024, height: 4032 };
  const FEED = IMAGE_SPECS.FEED_IMAGE;

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
});
