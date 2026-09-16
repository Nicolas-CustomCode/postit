import { randomBytes } from "node:crypto";
import {
  decodeEncryptionKey,
  DecryptionError,
  decryptSecret,
  encryptSecret,
  randomToken,
  secretsEqual,
  sha256Hex,
} from "./crypto";

const KEY = decodeEncryptionKey("a".repeat(64));
const OUTRA_CHAVE = decodeEncryptionKey("b".repeat(64));
const SEGREDO = "JBSWY3DPEHPK3PXP";

describe("secretsEqual", () => {
  it("aceita iguais e recusa diferentes, inclusive de tamanhos diferentes", () => {
    expect(secretsEqual("chave", "chave")).toBe(true);
    expect(secretsEqual("chave", "chaves")).toBe(false);
  });
});

describe("token opaco", () => {
  it("tem 43 caracteres em base64url e nunca se repete", () => {
    const um = randomToken();
    expect(um).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(um).not.toBe(randomToken());
  });

  it("o hash é estável e não devolve o token", () => {
    const token = randomToken();
    expect(sha256Hex(token)).toBe(sha256Hex(token));
    expect(sha256Hex(token)).not.toContain(token);
  });
});

describe("cifra dos segredos guardados", () => {
  it("decifra o que cifrou, com acento, emoji e texto vazio", () => {
    for (const texto of [SEGREDO, "ação de teste", "🔐", ""]) {
      expect(decryptSecret(encryptSecret(texto, KEY, "totp-secret"), KEY, "totp-secret")).toBe(texto);
    }
  });

  it("nunca produz o mesmo envelope duas vezes, e o segredo não aparece nele", () => {
    const um = encryptSecret(SEGREDO, KEY, "totp-secret");
    const outro = encryptSecret(SEGREDO, KEY, "totp-secret");
    expect(um).not.toBe(outro);
    expect(um).not.toContain(SEGREDO);
    expect(decryptSecret(outro, KEY, "totp-secret")).toBe(SEGREDO);
  });

  it("o envelope tem quatro partes e começa com v1", () => {
    const partes = encryptSecret(SEGREDO, KEY, "totp-secret").split(":");
    expect(partes).toHaveLength(4);
    expect(partes[0]).toBe("v1");
  });

  it("recusa texto cifrado adulterado, em vez de devolver lixo", () => {
    const [versao, iv, tag, texto] = encryptSecret(SEGREDO, KEY, "totp-secret").split(":");
    const adulterado = Buffer.from(texto ?? "", "base64url");
    adulterado[0] = (adulterado[0] ?? 0) ^ 0x01;
    const envelope = [versao, iv, tag, adulterado.toString("base64url")].join(":");
    expect(() => decryptSecret(envelope, KEY, "totp-secret")).toThrow(DecryptionError);
  });

  it("recusa tag trocada e iv trocado", () => {
    const [versao, iv, , texto] = encryptSecret(SEGREDO, KEY, "totp-secret").split(":");
    const outraTag = randomBytes(16).toString("base64url");
    expect(() => decryptSecret([versao, iv, outraTag, texto].join(":"), KEY, "totp-secret")).toThrow(DecryptionError);

    const [v2, , tag2, texto2] = encryptSecret(SEGREDO, KEY, "totp-secret").split(":");
    const outroIv = randomBytes(12).toString("base64url");
    expect(() => decryptSecret([v2, outroIv, tag2, texto2].join(":"), KEY, "totp-secret")).toThrow(DecryptionError);
  });

  it("recusa chave diferente", () => {
    const envelope = encryptSecret(SEGREDO, KEY, "totp-secret");
    expect(() => decryptSecret(envelope, OUTRA_CHAVE, "totp-secret")).toThrow(DecryptionError);
  });

  it("recusa o mesmo envelope com outro propósito — não dá para mover de coluna", () => {
    const envelope = encryptSecret(SEGREDO, KEY, "totp-secret");
    expect(() => decryptSecret(envelope, KEY, "instagram-token")).toThrow(DecryptionError);
  });

  it("recusa envelope de versão desconhecida, sem versão, ou com parte faltando", () => {
    const envelope = encryptSecret(SEGREDO, KEY, "totp-secret");
    const partes = envelope.split(":");
    expect(() => decryptSecret(`v2:${partes.slice(1).join(":")}`, KEY, "totp-secret")).toThrow(DecryptionError);
    expect(() => decryptSecret(partes.slice(1).join(":"), KEY, "totp-secret")).toThrow(DecryptionError);
    expect(() => decryptSecret("", KEY, "totp-secret")).toThrow(DecryptionError);
  });

  it("recusa chave com tamanho errado na decodificação, e não na hora de cifrar", () => {
    expect(() => decodeEncryptionKey("a".repeat(62))).toThrow("32 bytes");
  });

  it("o erro não carrega o segredo, a chave nem o texto cifrado", () => {
    const envelope = encryptSecret(SEGREDO, KEY, "totp-secret");
    try {
      decryptSecret(envelope, OUTRA_CHAVE, "totp-secret");
      throw new Error("deveria ter recusado");
    } catch (erro) {
      const serializado = `${String(erro)}${(erro as Error).stack ?? ""}`;
      expect(serializado).not.toContain(SEGREDO);
      expect(serializado).not.toContain(envelope);
      expect(serializado).not.toContain(KEY.toString("hex"));
    }
  });
});
