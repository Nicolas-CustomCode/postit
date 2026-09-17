import type { ApiEnv } from "../config/env";

/**
 * O que o módulo de contas precisa do ambiente. Mesmo padrão do AUTH_CONFIG:
 * nenhum serviço lê `process.env`.
 */
export const ACCOUNTS_CONFIG = "ACCOUNTS_CONFIG";

export interface AccountsConfig {
  /** O domínio de mídia que a tela e a Meta enxergam (docs/10). */
  readonly mediaPublicUrl: string;
}

export function accountsConfigFrom(env: ApiEnv): AccountsConfig {
  return { mediaPublicUrl: env.MINIO_PUBLIC_URL };
}
