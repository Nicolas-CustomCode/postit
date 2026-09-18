import type { ApiEnv, WorkerEnv } from "../config/env";

/**
 * O que o módulo de armazenamento precisa do ambiente. Mesmo padrão dos demais:
 * nenhum serviço lê `process.env`.
 */
export const STORAGE_CONFIG = "STORAGE_CONFIG";

export interface StorageConfig {
  /** Endereço interno do MinIO. Nunca chega ao navegador (AGENTS.md, regra 4). */
  readonly endpoint: string;
  readonly accessKey: string;
  readonly secretKey: string;
  readonly bucket: string;
}

export function storageConfigFrom(env: ApiEnv | WorkerEnv): StorageConfig {
  return {
    endpoint: env.MINIO_ENDPOINT,
    accessKey: env.MINIO_ROOT_USER,
    secretKey: env.MINIO_ROOT_PASSWORD,
    bucket: env.MINIO_BUCKET,
  };
}
