import {
  imageKindProblem,
  normalizationPlan,
  NORMALIZE_MAX_SIDE,
  sniffImageKind,
} from "./image-normalize";
import { imageUploadPreProblem } from "./media-types";

/**
 * Converter e reduzir antes do envio (RF-B06, a parte das imagens; ADR 0027).
 */
describe("normalizar imagem antes do envio", () => {
  const bytes = (...partes: (number[] | string)[]) =>
    Uint8Array.from(partes.flatMap((p) => (typeof p === "string" ? [...p].map((c) => c.charCodeAt(0)) : p)));

  describe("sniffImageKind — o tipo pelos bytes", () => {
    it("reconhece cada assinatura", () => {
      expect(sniffImageKind(bytes([0xff, 0xd8, 0xff, 0xe0]))).toBe("jpeg");
      expect(sniffImageKind(bytes([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))).toBe("png");
      expect(sniffImageKind(bytes("GIF89a"))).toBe("gif");
      expect(sniffImageKind(bytes("RIFF", [0, 0, 0, 0], "WEBP"))).toBe("webp");
      expect(sniffImageKind(bytes([0, 0, 0, 0x1c], "ftypavif"))).toBe("avif");
      expect(sniffImageKind(bytes([0, 0, 0, 0x18], "ftypheic"))).toBe("heic");
      expect(sniffImageKind(bytes([0, 0, 0, 0x18], "ftypmif1"))).toBe("heic");
    });

    it("lixo, arquivo curto e vídeo não são imagem", () => {
      expect(sniffImageKind(bytes("olá, mundo!!"))).toBeNull();
      expect(sniffImageKind(bytes([0xff, 0xd8]))).toBeNull();
      expect(sniffImageKind(new Uint8Array())).toBeNull();
      expect(sniffImageKind(bytes([0, 0, 0, 0x18], "ftypmp42"))).toBeNull();
    });
  });

  it("imageKindProblem recusa o que o navegador não converte", () => {
    expect(imageKindProblem(null)).toBe("UNREADABLE");
    expect(imageKindProblem("heic")).toBe("HEIC");
    expect(imageKindProblem("gif")).toBe("GIF");
    expect(imageKindProblem("png")).toBeNull();
    expect(imageKindProblem("jpeg")).toBeNull();
  });

  describe("normalizationPlan", () => {
    it("JPEG de até 8 MB fica intocado, mesmo enorme em pixels", () => {
      expect(normalizationPlan({ kind: "jpeg", bytes: 7_900_000, width: 6000, height: 4000 })).toEqual({
        action: "keep",
      });
    });

    it("PNG pequeno é convertido sem mudar de tamanho", () => {
      expect(normalizationPlan({ kind: "png", bytes: 500_000, width: 1080, height: 1350 })).toEqual({
        action: "reencode",
        reasons: ["CONVERTED"],
        width: 1080,
        height: 1350,
      });
    });

    it("PNG enorme é convertido e reduzido, com a proporção preservada", () => {
      expect(normalizationPlan({ kind: "png", bytes: 3_000_000, width: 5000, height: 200 })).toEqual({
        action: "reencode",
        reasons: ["CONVERTED", "REDUCED"],
        width: 2160,
        height: 86,
      });
    });

    it("JPEG acima de 8 MB é reduzido", () => {
      expect(normalizationPlan({ kind: "jpeg", bytes: 9_000_000, width: 6000, height: 4000 })).toEqual({
        action: "reencode",
        reasons: ["REDUCED"],
        width: 2160,
        height: 1440,
      });
    });

    it("JPEG pesado mas pequeno em pixels é recodificado no mesmo tamanho", () => {
      expect(normalizationPlan({ kind: "jpeg", bytes: 9_000_000, width: 2000, height: 2000 })).toEqual({
        action: "reencode",
        reasons: ["REDUCED"],
        width: 2000,
        height: 2000,
      });
    });

    it("acima de 50 megapixels é recusado: decodificar derruba a aba", () => {
      expect(normalizationPlan({ kind: "png", bytes: 30_000_000, width: 10_000, height: 6000 })).toEqual({
        action: "refuse",
        problem: "TOO_BIG_TO_CONVERT",
      });
    });

    it.each([
      [4032, 3024],
      [3024, 4032],
      [1080, 1920],
      [8000, 3000],
    ])("o lado maior nunca passa de 2160 (%i × %i)", (width, height) => {
      const plano = normalizationPlan({ kind: "webp", bytes: 1, width, height });
      if (plano.action !== "reencode") throw new Error("devia recodificar");
      expect(Math.max(plano.width, plano.height)).toBeLessThanOrEqual(NORMALIZE_MAX_SIDE);
      expect(plano.width / plano.height).toBeCloseTo(width / height, 1);
    });
  });

  describe("imageUploadPreProblem — antes de abrir o arquivo", () => {
    it("vazio é recusado", () => {
      expect(imageUploadPreProblem({ size: 0 })).toBe("EMPTY");
    });

    it("12 MB passa: vai ser reduzido; acima de 50 MB, não abre", () => {
      expect(imageUploadPreProblem({ size: 12_000_000 })).toBeNull();
      expect(imageUploadPreProblem({ size: 51_000_000 })).toBe("TOO_LARGE");
    });
  });
});
