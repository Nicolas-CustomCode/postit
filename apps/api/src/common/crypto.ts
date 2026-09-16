import { createCipheriv, createDecipheriv, createHash, randomBytes, timingSafeEqual } from "node:crypto";

/**
 * As primitivas de segredo do projeto, num arquivo só.
 *
 * Espalhar sorteio de token e cifra por vários lugares é como a entropia fraca
 * entra sem ninguém notar: um token curto funciona exatamente como um longo.
 */

/**
 * Compara dois segredos em tempo constante.
 *
 * Os dois lados passam por sha256 antes: timingSafeEqual exige o mesmo tamanho,
 * e comparar o tamanho antes vazaria quantos caracteres o segredo tem.
 */
export function secretsEqual(received: string, expected: string): boolean {
  const a = createHash("sha256").update(received).digest();
  const b = createHash("sha256").update(expected).digest();
  return timingSafeEqual(a, b);
}

/** Tamanho de todo token opaco do projeto: sessão, desafio e link. */
export const TOKEN_BYTES = 32;

/**
 * Sorteia um token opaco. base64url porque ele viaja em cookie e em URL de link
 * sem precisar de escape — 32 bytes viram 43 caracteres.
 */
export function randomToken(): string {
  return randomBytes(TOKEN_BYTES).toString("base64url");
}

/**
 * O que vai para o banco no lugar do token.
 *
 * O banco nunca vê o token em claro: um dump não permite se passar por ninguém.
 * sha256 sem sal de propósito — o valor já tem 256 bits de entropia, e a busca
 * precisa ser por igualdade indexada.
 */
export function sha256Hex(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

/** Falha de decifra. Mensagem fixa: qualquer detalhe aqui é pista sobre o segredo. */
export class DecryptionError extends Error {
  constructor() {
    super("Não foi possível decifrar o valor guardado");
    this.name = "DecryptionError";
  }
}

/**
 * Cifra simétrica dos segredos guardados — o segredo das duas etapas agora, o
 * token do Instagram no Bloco C (docs/11, "Tokens em repouso").
 *
 * AES-256-GCM: além de esconder, ele autentica. Um byte trocado no banco vira
 * erro, e não texto aleatório aceito como segredo.
 *
 * Envelope `v1:<iv>:<tag>:<texto cifrado>`, tudo em base64url. O prefixo de
 * versão existe para uma troca futura de algoritmo poder conviver com o que já
 * está gravado — sem ele, a migração só teria o caminho de recifrar tudo de uma
 * vez, parado.
 */
const ENVELOPE_VERSION = "v1";
const IV_BYTES = 12; // o tamanho que o GCM espera; outro valor enfraquece a cifra
const TAG_BYTES = 16;
const KEY_BYTES = 32;

/**
 * O "propósito" entra como dado autenticado: o mesmo texto cifrado não pode ser
 * movido da coluna do segredo das duas etapas para a do token do Instagram.
 * Custa nada e fecha uma porta inteira.
 */
export type SecretPurpose = "totp-secret" | "instagram-token";

export function encryptSecret(plain: string, key: Buffer, purpose: SecretPurpose): string {
  assertKey(key);
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  cipher.setAAD(Buffer.from(purpose, "utf8"));
  const ciphertext = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [ENVELOPE_VERSION, iv.toString("base64url"), tag.toString("base64url"), ciphertext.toString("base64url")].join(
    ":",
  );
}

export function decryptSecret(envelope: string, key: Buffer, purpose: SecretPurpose): string {
  assertKey(key);
  const parts = envelope.split(":");
  if (parts.length !== 4 || parts[0] !== ENVELOPE_VERSION) throw new DecryptionError();

  const iv = Buffer.from(parts[1] ?? "", "base64url");
  const tag = Buffer.from(parts[2] ?? "", "base64url");
  const ciphertext = Buffer.from(parts[3] ?? "", "base64url");
  if (iv.length !== IV_BYTES || tag.length !== TAG_BYTES) throw new DecryptionError();

  try {
    const decipher = createDecipheriv("aes-256-gcm", key, iv);
    decipher.setAAD(Buffer.from(purpose, "utf8"));
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString("utf8");
  } catch {
    // Texto adulterado, chave errada ou propósito trocado caem todos aqui, e
    // precisam ser indistinguíveis: a diferença entre eles é informação.
    throw new DecryptionError();
  }
}

/** A chave de 32 bytes vem de ENCRYPTION_KEY, já validada como 64 hexadecimais. */
export function decodeEncryptionKey(hex: string): Buffer {
  const key = Buffer.from(hex, "hex");
  assertKey(key);
  return key;
}

function assertKey(key: Buffer): void {
  // Erro de configuração, não de dado: precisa estourar no boot, não no login.
  if (key.length !== KEY_BYTES) throw new Error(`A chave de cifra precisa ter ${KEY_BYTES} bytes`);
}
