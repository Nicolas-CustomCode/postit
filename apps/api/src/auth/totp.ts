import { isTotpCodeShaped } from "@repo/shared";
import { generateSecret, generateURI, verifySync } from "otplib";
import { toDataURL } from "qrcode";
import { stepFor, TOTP_PERIOD_SECONDS, TOTP_TOLERANCE_SECONDS } from "../domain/auth/totp-window";

/**
 * O único lugar que fala com a biblioteca de código de 6 dígitos.
 *
 * A regra (tolerância, reuso) mora em `domain/auth/totp-window.ts`; aqui fica só
 * a tradução para a API do `otplib`. Trocar de biblioteca mexe neste arquivo e
 * em nenhum outro.
 *
 * ⚠️ A API mudou na versão 13: não existe mais o objeto `authenticator` da 12.
 * Confirmado em 16/09/2026 com a 13.5.0 (item V-17 do roadmap): `epochTolerance`
 * é em SEGUNDOS, aceita o passo anterior, o atual e o seguinte, e a resposta
 * traz `epoch` — o início do passo que bateu, que é o que guardamos contra
 * reuso.
 */

export function newTotpSecret(): string {
  return generateSecret();
}

export function otpauthUrl(issuer: string, email: string, secret: string): string {
  return generateURI({ issuer, label: email, secret });
}

/** QR como PNG embutido: a CSP libera `img-src data:` e nenhum arquivo é servido. */
export function qrCodeDataUrl(otpauth: string): Promise<string> {
  return toDataURL(otpauth);
}

export interface TotpCheck {
  readonly valid: boolean;
  /** O passo em que o código bateu — vira `totpUltimoPasso`, contra reuso. */
  readonly step: number | null;
}

export function verifyTotp(secret: string, code: string, now: Date): TotpCheck {
  // O otplib 13 LANÇA quando o código não tem 6 dígitos ("Token must be 6
  // digits"). Conferir o formato antes mantém isso como código errado comum.
  if (!isTotpCodeShaped(code)) return { valid: false, step: null };

  const result = verifySync({
    secret,
    token: code,
    epoch: Math.floor(now.getTime() / 1000),
    epochTolerance: TOTP_TOLERANCE_SECONDS,
  });

  if (!result.valid) return { valid: false, step: null };
  // `delta` é a distância em passos entre o código e o momento atual: 0 no
  // passo certo, -1 no anterior, +1 no seguinte. Somar ao passo de agora dá o
  // passo em que ele bateu — o número que guardamos contra reuso.
  return { valid: true, step: stepFor(now) + result.delta };
}

/** Exportado para o teste conseguir gerar um código válido sem esperar 30 s. */
export { TOTP_PERIOD_SECONDS };
