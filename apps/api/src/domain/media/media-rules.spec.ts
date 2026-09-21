import { formatsFor, IMAGE_MIME, validateImageUpload } from "@repo/shared";
import { jpegBytes } from "../../common/testing/image-fixtures";
import { detectImageType, orientedSize } from "./image-rules";

/**
 * O que os bytes do arquivo revelam (RF-B02; docs/08).
 *
 * As faixas por formato são testadas em `packages/shared/src/media-formats.spec.ts`,
 * onde moram. Aqui ficam a rotação do EXIF e a assinatura do arquivo — os dois
 * que só existem com o buffer em mãos.
 */
describe("bytes da imagem", () => {
  describe("orientedSize — a rotação do EXIF", () => {
    /*
     * O caso que motiva a função inteira: foto tirada em pé chega deitada nos
     * bytes, com a marca de girar. Sem aplicar, a proporção sai errada e uma
     * imagem que o Instagram vai cortar pareceria servir ao feed.
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

    /*
     * O efeito prático de girar: muda a resposta de "para que esta imagem
     * serve". Sem girar, a foto de celular em pé passaria por paisagem e o
     * sistema a ofereceria para o feed.
     */
    it("girar muda os formatos que a foto de celular atende", () => {
      expect(formatsFor(4032, 3024)).toContain("FEED");

      const real = orientedSize(4032, 3024, 6);
      expect(formatsFor(real.width, real.height)).toEqual(["STORIES"]);
    });

    /*
     * Mas o acervo aceita as duas: a proporção deixou de ser condição de envio
     * (RF-B03 — quem decide é o formato escolhido na composição).
     */
    it("nas duas orientações, a imagem entra no acervo", () => {
      const fatos = { mimeType: IMAGE_MIME, bytes: 1_000_000 };

      expect(validateImageUpload({ ...fatos, width: 4032, height: 3024 })).toBeNull();
      expect(validateImageUpload({ ...fatos, width: 3024, height: 4032 })).toBeNull();
    });
  });

  /*
   * O tipo sai dos BYTES, nunca do que o navegador declarou — quem envia
   * controla o cabeçalho.
   */
  describe("detectImageType", () => {
    it("reconhece um JPEG de verdade", () => {
      expect(detectImageType(jpegBytes({ width: 1080, height: 1080 }))).toBe(IMAGE_MIME);
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
