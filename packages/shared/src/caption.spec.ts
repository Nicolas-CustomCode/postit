import {
  captionCounts,
  captionProblem,
  CAPTION_MAX_HASHTAGS,
  CAPTION_MAX_LENGTH,
  CAPTION_MAX_MENTIONS,
} from "./caption";

/**
 * Os limites da legenda (RF-C03).
 *
 * Os limites exatos importam: passar de 2200 caracteres faz a publicação falhar
 * na Meta, de madrugada, sem ninguém olhando.
 */
describe("legenda", () => {
  describe("contagem", () => {
    it("conta hashtags e menções separadas", () => {
      expect(captionCounts("Olha isso #sol #mar com @fulano")).toEqual({
        length: 31,
        hashtags: 2,
        mentions: 1,
      });
    });

    it("legenda vazia não tem nada", () => {
      expect(captionCounts("")).toEqual({ length: 0, hashtags: 0, mentions: 0 });
    });

    it("aceita acento em hashtag", () => {
      expect(captionCounts("#café #ação").hashtags).toBe(2);
    });

    /*
     * O falso positivo que a regra de "começar palavra" evita: sem ela, todo
     * e-mail na legenda viraria menção e a pessoa levaria uma recusa sem
     * entender o motivo.
     */
    it("e-mail não é menção", () => {
      expect(captionCounts("Fale com contato@empresa.com").mentions).toBe(0);
    });

    it("cerquilha no meio de palavra não é hashtag", () => {
      expect(captionCounts("item nº1 modelo abc#123").hashtags).toBe(0);
    });

    it("hashtag e menção no começo do texto contam", () => {
      expect(captionCounts("#promo").hashtags).toBe(1);
      expect(captionCounts("@loja").mentions).toBe(1);
    });

    it("hashtag sozinha, sem palavra depois, não conta", () => {
      expect(captionCounts("olha # isso").hashtags).toBe(0);
    });

    /*
     * A escolha de contar em unidades UTF-16, a maior das contagens possíveis:
     * um emoji fora do plano básico ocupa 2. Está documentado em caption.ts
     * porque a Meta não diz como conta.
     */
    it("emoji conta 2, que é a contagem mais conservadora", () => {
      expect(captionCounts("🌊").length).toBe(2);
    });
  });

  describe("captionProblem — os limites exatos", () => {
    it("legenda dentro dos limites passa", () => {
      expect(captionProblem("Um dia bonito #sol")).toBeNull();
    });

    it("2200 caracteres passam; 2201 não", () => {
      expect(captionProblem("a".repeat(CAPTION_MAX_LENGTH))).toBeNull();
      expect(captionProblem("a".repeat(CAPTION_MAX_LENGTH + 1))).toBe("POST_CAPTION_TOO_LONG");
    });

    it("30 hashtags passam; 31 não", () => {
      const hashtags = (quantas: number) =>
        Array.from({ length: quantas }, (_, i) => `#tag${i}`).join(" ");

      expect(captionProblem(hashtags(CAPTION_MAX_HASHTAGS))).toBeNull();
      expect(captionProblem(hashtags(CAPTION_MAX_HASHTAGS + 1))).toBe("POST_TOO_MANY_HASHTAGS");
    });

    it("20 menções passam; 21 não", () => {
      const mencoes = (quantas: number) =>
        Array.from({ length: quantas }, (_, i) => `@perfil${i}`).join(" ");

      expect(captionProblem(mencoes(CAPTION_MAX_MENTIONS))).toBeNull();
      expect(captionProblem(mencoes(CAPTION_MAX_MENTIONS + 1))).toBe("POST_TOO_MANY_MENTIONS");
    });

    it("o tamanho é conferido primeiro: legenda gigante reclama do tamanho", () => {
      const gigante = `${"a".repeat(CAPTION_MAX_LENGTH + 1)} ${Array.from({ length: 40 }, (_, i) => `#t${i}`).join(" ")}`;
      expect(captionProblem(gigante)).toBe("POST_CAPTION_TOO_LONG");
    });
  });
});
