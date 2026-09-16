import { createHmac } from "node:crypto";

/**
 * Gera o código de 6 dígitos como um aplicativo autenticador faria (RFC 6238).
 *
 * É implementado aqui, e não com a biblioteca da API, por dois motivos: o teste
 * confere o sistema **de fora**, com uma implementação independente — se os dois
 * lados usassem o mesmo código, um erro combinaria com ele mesmo — e a
 * biblioteca é publicada só como ESM, o que atrapalharia o carregamento aqui.
 */

const BASE32 = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

function decodeBase32(secret: string): Buffer {
  let bits = "";
  for (const character of secret.toUpperCase().replace(/=+$/, "")) {
    const value = BASE32.indexOf(character);
    if (value < 0) throw new Error(`Caractere fora do base32: ${character}`);
    bits += value.toString(2).padStart(5, "0");
  }

  const bytes: number[] = [];
  for (let index = 0; index + 8 <= bits.length; index += 8) {
    bytes.push(Number.parseInt(bits.slice(index, index + 8), 2));
  }
  return Buffer.from(bytes);
}

/** `stepOffset` serve para pedir o código do passo anterior ou do seguinte. */
export function totpCode(secret: string, stepOffset = 0): string {
  const step = Math.floor(Date.now() / 1000 / 30) + stepOffset;

  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(step));

  const digest = createHmac("sha1", decodeBase32(secret)).update(counter).digest();
  const offset = (digest[digest.length - 1] as number) & 0x0f;
  const binary =
    (((digest[offset] as number) & 0x7f) << 24) |
    (((digest[offset + 1] as number) & 0xff) << 16) |
    (((digest[offset + 2] as number) & 0xff) << 8) |
    ((digest[offset + 3] as number) & 0xff);

  return String(binary % 1_000_000).padStart(6, "0");
}

/** O segredo vem do link otpauth:// que a tela de cadastro mostra. */
export function secretFromOtpauth(url: string): string {
  const parsed = new URL(url.replace("otpauth://", "https://"));
  const secret = parsed.searchParams.get("secret");
  if (secret === null) throw new Error("O link otpauth não trouxe o segredo");
  return secret;
}
