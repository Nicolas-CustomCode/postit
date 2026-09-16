/**
 * Formato dos códigos de recuperação (ADR 0013): 10 códigos, mostrados uma única
 * vez, usados quando a pessoa perde o aplicativo autenticador.
 *
 * O alfabeto não tem 0, O, 1, I nem L: o código é anotado no papel e digitado
 * depois, e esses pares são os que as pessoas confundem.
 *
 * A quantidade e o alfabeto ficam no código, e não em variável de ambiente: são
 * formato, não ajuste de operação. Mudar depois invalidaria os códigos já
 * anotados.
 */
export const RECOVERY_CODE_ALPHABET = "23456789ABCDEFGHJKMNPQRSTUVWXYZ";
export const RECOVERY_CODE_COUNT = 10;
/** Dois grupos de 5, separados por hífen: mais fácil de ler em voz alta. */
export const RECOVERY_CODE_GROUP = 5;

const SHAPE = new RegExp(`^[${RECOVERY_CODE_ALPHABET}]{${RECOVERY_CODE_GROUP}}-[${RECOVERY_CODE_ALPHABET}]{${RECOVERY_CODE_GROUP}}$`);

/** Aceita como a pessoa digitou: minúsculas, espaços e hífen esquecido. */
export function normalizeRecoveryCode(raw: string): string {
  const clean = raw.trim().toUpperCase().replace(/[\s-]/g, "");
  if (clean.length !== RECOVERY_CODE_GROUP * 2) return clean;
  return `${clean.slice(0, RECOVERY_CODE_GROUP)}-${clean.slice(RECOVERY_CODE_GROUP)}`;
}

/** Confere o formato antes de ir ao banco, como em todo token deste projeto. */
export function isRecoveryCodeShaped(value: string): boolean {
  return SHAPE.test(value);
}

/** Código de 6 dígitos do aplicativo. O otplib 13 LANÇA com formato diferente. */
export function isTotpCodeShaped(value: string): boolean {
  return /^[0-9]{6}$/.test(value);
}
