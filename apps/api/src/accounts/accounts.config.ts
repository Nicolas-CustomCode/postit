import { decodeEncryptionKey } from "../common/crypto";
import type { ApiEnv } from "../config/env";

/**
 * O que o módulo de contas precisa do ambiente. Mesmo padrão do AUTH_CONFIG:
 * nenhum serviço lê `process.env`.
 */
export const ACCOUNTS_CONFIG = "ACCOUNTS_CONFIG";

export interface AccountsConfig {
  /** O domínio de mídia que a tela e a Meta enxergam (docs/10). */
  readonly mediaPublicUrl: string;
  /**
   * O bucket entra no caminho da URL pública, porque é assim que o MinIO serve.
   * Fica aqui, e não no banco: bucket é infraestrutura, e a chave guardada em
   * `fotoChaveObjeto` precisa continuar valendo se um dia ele mudar de nome.
   */
  readonly mediaBucket: string;
  /**
   * A mesma chave do AUTH_CONFIG, decodificada aqui em vez de importada de lá.
   *
   * Importar o `AuthModule` só para pegar a chave registraria o `AuthController`
   * uma segunda vez — `forEnv` devolve um módulo novo a cada chamada, e o
   * Fastify recusa a rota duplicada. Foi exatamente o que aconteceu.
   */
  readonly encryptionKey: Buffer;
}

export function accountsConfigFrom(env: ApiEnv): AccountsConfig {
  return {
    mediaPublicUrl: env.MINIO_PUBLIC_URL,
    mediaBucket: env.MINIO_BUCKET,
    encryptionKey: decodeEncryptionKey(env.ENCRYPTION_KEY),
  };
}
