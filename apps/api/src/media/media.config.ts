import type { ApiEnv } from "../config/env";

/**
 * O que o módulo de mídia precisa do ambiente. Mesmo padrão dos demais: nenhum
 * serviço lê `process.env`.
 */
export const MEDIA_CONFIG = "MEDIA_CONFIG";

export interface MediaConfig {
  /**
   * Quanto tempo a permissão de envio vale.
   *
   * Curto de propósito: a política não é invalidada pelo primeiro uso, então o
   * prazo **é** o que limita o reuso. Cinco minutos cobrem um envio de 8 MB numa
   * conexão ruim e não deixam a autorização circulando.
   */
  readonly uploadTtlSeconds: number;
  /**
   * O mesmo `STATE_SECRET` que assina o `state` do OAuth.
   *
   * Vem do próprio config, e **não** importando o `AuthModule`: `forEnv` devolve
   * um módulo novo a cada chamada, e importar o de autenticação registraria o
   * controlador dele de novo — o Fastify recusa a rota duplicada. Já aconteceu.
   */
  readonly uploadSecret: Buffer;
  /** O domínio de mídia que a tela enxerga (docs/10). */
  readonly mediaPublicUrl: string;
  /** O bucket entra no caminho da URL pública, porque é assim que o MinIO serve. */
  readonly mediaBucket: string;
}

export function mediaConfigFrom(env: ApiEnv): MediaConfig {
  return {
    uploadTtlSeconds: 5 * 60,
    uploadSecret: Buffer.from(env.STATE_SECRET, "hex"),
    mediaPublicUrl: env.MINIO_PUBLIC_URL,
    mediaBucket: env.MINIO_BUCKET,
  };
}
