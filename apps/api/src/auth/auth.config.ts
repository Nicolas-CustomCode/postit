import { decodeEncryptionKey } from "../common/crypto";
import type { ApiEnv } from "../config/env";
import type { AccessLinkTtl } from "../domain/auth/access-link";
import type { LockoutConfig } from "../domain/auth/lockout";

/**
 * Os prazos e limites do login, já convertidos das variáveis de ambiente.
 *
 * Os serviços recebem isto pronto e não leem `process.env`: é o mesmo padrão do
 * resto da API — o ambiente é validado uma vez no boot e desce pelo módulo.
 */
export const AUTH_CONFIG = "AUTH_CONFIG";

export interface AuthConfig {
  readonly sessionIdleDays: number;
  readonly sessionMaxDays: number;
  readonly challengeTtlMinutes: number;
  readonly challengeMaxAttempts: number;
  readonly recentConfirmationMinutes: number;
  readonly totpIssuer: string;
  readonly lockout: LockoutConfig;
  readonly linkTtl: AccessLinkTtl;
  /** Já decodificada: chave com tamanho errado derruba o boot, não o login. */
  readonly encryptionKey: Buffer;
}

export function authConfigFrom(env: ApiEnv): AuthConfig {
  return {
    sessionIdleDays: env.SESSION_IDLE_DAYS,
    sessionMaxDays: env.SESSION_MAX_DAYS,
    challengeTtlMinutes: env.CHALLENGE_TTL_MINUTES,
    challengeMaxAttempts: env.CHALLENGE_MAX_ATTEMPTS,
    recentConfirmationMinutes: env.RECENT_CONFIRMATION_MINUTES,
    totpIssuer: env.TOTP_ISSUER,
    lockout: {
      windowMinutes: env.LOCKOUT_WINDOW_MINUTES,
      accountAttempts: env.LOCKOUT_ACCOUNT_ATTEMPTS,
      accountMinutes: env.LOCKOUT_ACCOUNT_MINUTES,
      ipAttempts: env.LOCKOUT_IP_ATTEMPTS,
      ipMinutes: env.LOCKOUT_IP_MINUTES,
      repeatMinutes: env.LOCKOUT_REPEAT_MINUTES,
      repeatWindowHours: env.LOCKOUT_REPEAT_WINDOW_HOURS,
    },
    linkTtl: { signupDays: env.SIGNUP_LINK_DAYS, passwordResetHours: env.PASSWORD_RESET_LINK_HOURS },
    encryptionKey: decodeEncryptionKey(env.ENCRYPTION_KEY),
  };
}
