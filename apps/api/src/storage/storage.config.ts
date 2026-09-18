import type { ApiEnv, WorkerEnv } from "../config/env";

/**
 * O que o módulo de armazenamento precisa do ambiente. Mesmo padrão dos demais:
 * nenhum serviço lê `process.env`.
 */
export const STORAGE_CONFIG = "STORAGE_CONFIG";

export interface StorageConfig {
  /** Endereço interno do MinIO. Nunca chega ao navegador (AGENTS.md, regra 4). */
  readonly endpoint: string;
  /**
   * O endereço que o navegador enxerga — o domínio de mídia, ou o túnel no
   * desenvolvimento. É ele que vai no destino da política de envio, no lugar do
   * host interno que o SDK monta sozinho (ADR 0012).
   */
  readonly publicUrl: string;
  readonly accessKey: string;
  readonly secretKey: string;
  readonly bucket: string;
}

export function storageConfigFrom(env: ApiEnv | WorkerEnv): StorageConfig {
  return {
    endpoint: env.MINIO_ENDPOINT,
    publicUrl: env.MINIO_PUBLIC_URL,
    accessKey: env.MINIO_ROOT_USER,
    secretKey: env.MINIO_ROOT_PASSWORD,
    bucket: env.MINIO_BUCKET,
  };
}
