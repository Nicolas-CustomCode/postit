/**
 * A janela de tempo do código de 6 dígitos (ADR 0013, seção 1).
 *
 * O código muda a cada 30 segundos. Cada intervalo desses é um "passo", contado
 * desde 1970 — é o mesmo número que o aplicativo do celular usa.
 *
 * Dois cuidados que andam juntos:
 *  - **tolerância de ±1 passo**, porque o relógio do celular atrasa e adianta;
 *  - **anti-reuso**: guardamos o último passo aceito por usuário, e um código do
 *    mesmo passo ou de um passo anterior é recusado. Sem isso, quem vir o código
 *    por cima do ombro tem 30 segundos para usá-lo de novo.
 *
 * Fica no domínio, e não junto da biblioteca, para trocar de biblioteca não
 * mexer na regra.
 */

export const TOTP_PERIOD_SECONDS = 30;
/** ±1 passo. Em segundos, porque é assim que o otplib 13 recebe (item V-17). */
export const TOTP_TOLERANCE_SECONDS = TOTP_PERIOD_SECONDS;

export function stepFor(now: Date): number {
  return Math.floor(now.getTime() / 1000 / TOTP_PERIOD_SECONDS);
}

/**
 * `lastStep` é o último passo aceito para aquele usuário; `step` é o passo do
 * código que acabou de chegar. Igual ou anterior é reuso.
 */
export function isReplay(lastStep: number | null, step: number): boolean {
  return lastStep !== null && step <= lastStep;
}
