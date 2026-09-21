import { POST_FORMATS } from "./domain";
import { POST_MEDIA_COUNT, POST_MEDIA_MAX, postMediaCountProblem } from "./post-formats";

/**
 * Quantas mídias cada formato aceita (docs/08; ADR 0024).
 *
 * É a regra que substitui o valor `CARROSSEL` do enum: carrossel deixou de ser
 * uma escolha e virou a consequência de haver mais de uma mídia. Errar o teto
 * aqui custa o erro 2207028 da Meta **na hora de publicar**, de madrugada.
 */
describe("quantidade de mídias por formato", () => {
  describe("Feed — de 1 a 10, e o carrossel nasce do segundo", () => {
    it("sem mídia nenhuma não há o que publicar", () => {
      expect(postMediaCountProblem("FEED", 0)).toBe("POST_MEDIA_REQUIRED");
    });

    it("uma é imagem simples, duas já são carrossel, e dez é o limite", () => {
      expect(postMediaCountProblem("FEED", 1)).toBeNull();
      expect(postMediaCountProblem("FEED", 2)).toBeNull();
      expect(postMediaCountProblem("FEED", 10)).toBeNull();
    });

    it("onze passa do que a Meta aceita", () => {
      expect(postMediaCountProblem("FEED", 11)).toBe("POST_TOO_MANY_MEDIA");
    });
  });

  /*
   * Reels não pode entrar em carrossel e Stories não tem `children` na matriz de
   * parâmetros da Meta: os dois são publicação de uma mídia só. O código é outro
   * porque a correção é outra — não é "remova até sobrar dez", é "este formato
   * não comporta mais de uma".
   */
  describe("Stories e Reels — exatamente uma", () => {
    it.each(["STORIES", "REELS"] as const)("%s aceita uma, e só uma", (formato) => {
      expect(postMediaCountProblem(formato, 0)).toBe("POST_MEDIA_REQUIRED");
      expect(postMediaCountProblem(formato, 1)).toBeNull();
      expect(postMediaCountProblem(formato, 2)).toBe("POST_FORMAT_SINGLE_MEDIA");
    });
  });

  /*
   * Estes dois existem para o dia em que um formato novo entrar no enum: sem
   * faixa, `POST_MEDIA_COUNT[formato]` seria `undefined` e a leitura de `.min`
   * estouraria em produção, não aqui.
   */
  describe("a tabela cobre o enum inteiro", () => {
    it("todo formato tem faixa", () => {
      expect(Object.keys(POST_MEDIA_COUNT).sort()).toEqual([...POST_FORMATS].sort());
    });

    it("nenhum formato passa do teto que o schema de entrada limita", () => {
      for (const faixa of Object.values(POST_MEDIA_COUNT)) {
        expect(faixa.min).toBeGreaterThanOrEqual(1);
        expect(faixa.max).toBeLessThanOrEqual(POST_MEDIA_MAX);
      }
    });
  });
});
