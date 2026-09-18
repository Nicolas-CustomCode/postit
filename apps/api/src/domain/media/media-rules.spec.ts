import { FEED_IMAGE_MAX_BYTES, FEED_IMAGE_MIME } from "@repo/shared";
import { jpegBytes } from "../../common/testing/image-fixtures";
import { detectImageType, orientedSize, validateFeedImage } from "./image-rules";

/**
 * As regras de imagem de feed (RF-B02; docs/08).
 *
 * Puras: rodam sem banco, sem rede e sem MinIO. É aqui que os limites da Meta
 * viram decisão, e um erro silencioso custa uma publicação recusada de
 * madrugada.
 */
describe("imagem de feed", () => {
  const imagem = (partes: Partial<Parameters<typeof validateFeedImage>[0]> = {}) => ({
    mimeType: FEED_IMAGE_MIME,
    bytes: 1_000_000,
    width: 1080,
    height: 1080,
    ...partes,
  });

  describe("orientedSize — a rotação do EXIF", () => {
    /*
     * O caso que motiva a função inteira: foto tirada em pé chega deitada nos
     * bytes, com a marca de girar. Sem aplicar, a proporção sai errada e uma
     * imagem que o Instagram vai cortar passaria como válida.
     */
    it("orientações 5 a 8 trocam largura e altura", () => {
      for (const orientacao of [5, 6, 7, 8]) {
        expect(orientedSize(4032, 3024, orientacao)).toEqual({ width: 3024, height: 4032 });
      }
    });

    it("orientações 1 a 4 não mexem nas medidas", () => {
      for (const orientacao of [1, 2, 3, 4]) {
        expect(orientedSize(4032, 3024, orientacao)).toEqual({ width: 4032, height: 3024 });
      }
    });

    it("sem orientação nenhuma, fica como veio", () => {
      expect(orientedSize(1080, 1350, undefined)).toEqual({ width: 1080, height: 1350 });
    });

    it("a foto de celular em pé é recusada por proporção, e não aceita como paisagem", () => {
      // 4032×3024 nos bytes, orientação 6: parece paisagem 1,33 e passaria.
      expect(validateFeedImage(imagem({ width: 4032, height: 3024 }))).toBeNull();

      // Girada, é retrato 0,75 — abaixo do mínimo de 4:5.
      const real = orientedSize(4032, 3024, 6);
      expect(validateFeedImage(imagem(real))).toBe("MEDIA_RATIO_UNSUPPORTED");
    });
  });

  describe("validateFeedImage", () => {
    it("aceita uma imagem dentro de todos os limites", () => {
      expect(validateFeedImage(imagem())).toBeNull();
    });

    it("recusa o que não é JPEG — a recusa mais comum do dia a dia", () => {
      expect(validateFeedImage(imagem({ mimeType: "image/png" }))).toBe("MEDIA_WRONG_TYPE");
      expect(validateFeedImage(imagem({ mimeType: "image/webp" }))).toBe("MEDIA_WRONG_TYPE");
    });

    it("recusa acima do limite de bytes, e aceita exatamente no limite", () => {
      expect(validateFeedImage(imagem({ bytes: FEED_IMAGE_MAX_BYTES + 1 }))).toBe("MEDIA_TOO_LARGE");
      expect(validateFeedImage(imagem({ bytes: FEED_IMAGE_MAX_BYTES }))).toBeNull();
    });

    it("recusa largura abaixo de 320, e aceita exatamente 320", () => {
      expect(validateFeedImage(imagem({ width: 319, height: 320 }))).toBe("MEDIA_TOO_NARROW");
      expect(validateFeedImage(imagem({ width: 320, height: 320 }))).toBeNull();
    });

    /*
     * A decisão do projeto: largura acima de 1440 passa. A Meta redimensiona
     * sozinha e não devolve erro, e recusar barraria quase toda foto de celular
     * (docs/08, nota sobre largura).
     */
    it("aceita largura acima de 1440, que a Meta redimensiona sozinha", () => {
      expect(validateFeedImage(imagem({ width: 3024, height: 3024 }))).toBeNull();
    });

    describe("proporção — os limites exatos", () => {
      it("1080×1350 é exatamente 4:5 e passa", () => {
        expect(validateFeedImage(imagem({ width: 1080, height: 1350 }))).toBeNull();
      });

      it("um pixel mais alto que 4:5 é recusado", () => {
        expect(validateFeedImage(imagem({ width: 1080, height: 1351 }))).toBe("MEDIA_RATIO_UNSUPPORTED");
      });

      it("1910×1000 é exatamente 1.91:1 e passa", () => {
        expect(validateFeedImage(imagem({ width: 1910, height: 1000 }))).toBeNull();
      });

      it("um pixel mais largo que 1.91:1 é recusado", () => {
        expect(validateFeedImage(imagem({ width: 1911, height: 1000 }))).toBe("MEDIA_RATIO_UNSUPPORTED");
      });

      it("2:1 é recusado — o caso do roteiro da fase", () => {
        expect(validateFeedImage(imagem({ width: 2000, height: 1000 }))).toBe("MEDIA_RATIO_UNSUPPORTED");
      });

      it("altura zero não vira divisão por zero", () => {
        expect(validateFeedImage(imagem({ width: 1080, height: 0 }))).toBe("MEDIA_RATIO_UNSUPPORTED");
      });
    });

    it("confere o tipo primeiro: um PNG gigante reclama do tipo, não do tamanho", () => {
      const problema = validateFeedImage(
        imagem({ mimeType: "image/png", bytes: FEED_IMAGE_MAX_BYTES * 2 }),
      );
      expect(problema).toBe("MEDIA_WRONG_TYPE");
    });
  });

  /*
   * O tipo sai dos BYTES, nunca do que o navegador declarou — quem envia
   * controla o cabeçalho.
   */
  describe("detectImageType", () => {
    it("reconhece um JPEG de verdade", () => {
      expect(detectImageType(jpegBytes({ width: 1080, height: 1080 }))).toBe(FEED_IMAGE_MIME);
    });

    it("recusa quem não começa com a assinatura de JPEG", () => {
      // Assinatura de PNG.
      expect(detectImageType(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))).toBeNull();
      expect(detectImageType(Buffer.from([0xff, 0xd8]))).toBeNull();
      expect(detectImageType(Buffer.alloc(0))).toBeNull();
    });

    /*
     * MPO é a foto 3D de algumas câmeras. Começa com os mesmos três bytes de um
     * JPEG, e o docs/08 diz que a Meta não o aceita — se passasse daqui, a
     * recusa viria só na hora de publicar.
     */
    it("recusa MPO, que começa igual a um JPEG", () => {
      expect(detectImageType(jpegBytes({ width: 1080, height: 1080, mpo: true }))).toBeNull();
    });
  });
});
