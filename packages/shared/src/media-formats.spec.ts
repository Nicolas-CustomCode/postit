import {
  formatsFor,
  IMAGE_MAX_BYTES,
  IMAGE_MIME,
  IMAGE_SPECS,
  isImageFormat,
  ratioFits,
  validateImageFormat,
  validateImageUpload,
  type ImageFacts,
} from "./media-formats";

/**
 * As especificações de imagem por formato (RF-B02, RF-B03; docs/08).
 *
 * Puras: rodam sem banco, sem rede e sem MinIO. É aqui que os limites da Meta
 * viram decisão, e um erro silencioso custa uma publicação recusada de
 * madrugada.
 */
describe("especificações de imagem", () => {
  const imagem = (partes: Partial<ImageFacts> = {}): ImageFacts => ({
    mimeType: IMAGE_MIME,
    bytes: 1_000_000,
    width: 1080,
    height: 1080,
    ...partes,
  });

  /*
   * O piso do acervo: o que reprova em QUALQUER formato. Não olha proporção,
   * porque não existe faixa comum — a do feed é apertada, a de Stories não
   * existe.
   */
  describe("validateImageUpload — o piso do envio", () => {
    it("aceita uma imagem dentro de todos os limites", () => {
      expect(validateImageUpload(imagem())).toBeNull();
    });

    it("recusa o que não é JPEG — a recusa mais comum do dia a dia", () => {
      expect(validateImageUpload(imagem({ mimeType: "image/png" }))).toBe("MEDIA_WRONG_TYPE");
      expect(validateImageUpload(imagem({ mimeType: "image/webp" }))).toBe("MEDIA_WRONG_TYPE");
    });

    it("recusa acima do limite de bytes, e aceita exatamente no limite", () => {
      expect(validateImageUpload(imagem({ bytes: IMAGE_MAX_BYTES + 1 }))).toBe("MEDIA_TOO_LARGE");
      expect(validateImageUpload(imagem({ bytes: IMAGE_MAX_BYTES }))).toBeNull();
    });

    it("recusa largura abaixo de 320, e aceita exatamente 320", () => {
      expect(validateImageUpload(imagem({ width: 319, height: 320 }))).toBe("MEDIA_TOO_NARROW");
      expect(validateImageUpload(imagem({ width: 320, height: 320 }))).toBeNull();
    });

    /*
     * A decisão do projeto: largura acima de 1440 passa. A Meta redimensiona
     * sozinha e não devolve erro, e recusar barraria quase toda foto de celular
     * (docs/08, nota sobre largura).
     */
    it("aceita largura acima de 1440, que a Meta redimensiona sozinha", () => {
      expect(validateImageUpload(imagem({ width: 3024, height: 3024 }))).toBeNull();
    });

    /*
     * O defeito que esta parte corrige. Antes, o envio validava tudo contra o
     * feed: uma arte 9:16 de Stories era recusada e recortada para 4:5, e a foto
     * de celular em pé (3:4) não entrava no acervo de jeito nenhum.
     */
    it("aceita proporções que não servem ao feed — 9:16 e 3:4", () => {
      expect(validateImageUpload(imagem({ width: 1080, height: 1920 }))).toBeNull();
      expect(validateImageUpload(imagem({ width: 3024, height: 4032 }))).toBeNull();
      expect(validateImageUpload(imagem({ width: 2000, height: 1000 }))).toBeNull();
    });

    it("confere o tipo primeiro: um PNG gigante reclama do tipo, não do tamanho", () => {
      expect(validateImageUpload(imagem({ mimeType: "image/png", bytes: IMAGE_MAX_BYTES * 2 }))).toBe(
        "MEDIA_WRONG_TYPE",
      );
    });
  });

  describe("ratioFits — os limites exatos do feed", () => {
    const FEED = IMAGE_SPECS.FEED;

    it("1080×1350 é exatamente 4:5 e passa", () => {
      expect(ratioFits(1080, 1350, FEED)).toBe(true);
    });

    it("um pixel mais alto que 4:5 não passa", () => {
      expect(ratioFits(1080, 1351, FEED)).toBe(false);
    });

    it("1910×1000 é exatamente 1.91:1 e passa", () => {
      expect(ratioFits(1910, 1000, FEED)).toBe(true);
    });

    it("um pixel mais largo que 1.91:1 não passa", () => {
      expect(ratioFits(1911, 1000, FEED)).toBe(false);
    });

    it("2:1 não passa — o caso do roteiro da fase", () => {
      expect(ratioFits(2000, 1000, FEED)).toBe(false);
    });

    it("medida inválida não passa", () => {
      expect(ratioFits(1080, 0, FEED)).toBe(false);
      expect(ratioFits(0, 1080, FEED)).toBe(false);
    });

    /*
     * A Meta só diz "9:16 recomendado" para imagem de Stories, sem faixa
     * obrigatória — e recomendado não é obrigatório. Sem fonte, não há o que
     * recusar (docs/08, "A validar em desenvolvimento").
     */
    it("formato sem faixa aceita qualquer proporção", () => {
      expect(ratioFits(1080, 1920, IMAGE_SPECS.STORIES)).toBe(true);
      expect(ratioFits(4000, 400, IMAGE_SPECS.STORIES)).toBe(true);
    });

    it("mesmo sem faixa, medida inválida continua reprovando", () => {
      expect(ratioFits(1080, 0, IMAGE_SPECS.STORIES)).toBe(false);
    });
  });

  describe("validateImageFormat — a decisão da composição", () => {
    it("a mesma imagem serve a um formato e não a outro", () => {
      const stories = imagem({ width: 1080, height: 1920 });

      expect(validateImageFormat(stories, "STORIES")).toBeNull();
      expect(validateImageFormat(stories, "FEED")).toBe("MEDIA_RATIO_UNSUPPORTED");
    });

    it("o piso vale antes da proporção: PNG 9:16 reclama do tipo", () => {
      expect(validateImageFormat(imagem({ mimeType: "image/png", width: 1080, height: 1920 }), "STORIES")).toBe(
        "MEDIA_WRONG_TYPE",
      );
    });

  });

  describe("formatsFor — para que esta imagem serve", () => {
    it("quadrada serve para tudo", () => {
      expect(formatsFor(1080, 1080)).toEqual(["FEED", "STORIES"]);
    });

    it("9:16 serve só para Stories", () => {
      expect(formatsFor(1080, 1920)).toEqual(["STORIES"]);
    });

    it("a foto de celular em pé, 3:4, serve só para Stories", () => {
      expect(formatsFor(3024, 4032)).toEqual(["STORIES"]);
    });

    it("panorâmica 4:1 serve só para Stories", () => {
      expect(formatsFor(4000, 1000)).toEqual(["STORIES"]);
    });

    it("medida inválida não serve para nada", () => {
      expect(formatsFor(1080, 0)).toEqual([]);
    });
  });

  describe("isImageFormat", () => {
    it("separa o que é imagem do que é vídeo", () => {
      expect(isImageFormat("FEED")).toBe(true);
      expect(isImageFormat("STORIES")).toBe(true);
      expect(isImageFormat("REELS")).toBe(false);
    });
  });
});
