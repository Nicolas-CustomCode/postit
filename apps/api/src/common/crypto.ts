import { createHash, timingSafeEqual } from "node:crypto";

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
