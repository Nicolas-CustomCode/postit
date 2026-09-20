import type { ApiEnv } from "../config/env";

/**
 * O que o módulo de postagens precisa do ambiente. Mesmo padrão do
 * `ACCOUNTS_CONFIG`: nenhum serviço lê `process.env`.
 *
 * ⚠️ **Config própria, e não o `ACCOUNTS_CONFIG` importado.** Importar o
 * `AccountsModule` para reaproveitar os dois campos registraria o
 * `AccountsController` uma segunda vez — `forEnv` devolve um módulo novo a cada
 * chamada, e o Fastify recusa a rota duplicada. Já aconteceu no projeto, e é o
 * mesmo motivo comentado lá.
 */
export const POSTS_CONFIG = "POSTS_CONFIG";

export interface PostsConfig {
  /** O domínio de mídia que a tela enxerga (docs/10). */
  readonly mediaPublicUrl: string;
  /** O bucket entra no caminho da URL pública, porque é assim que o MinIO serve. */
  readonly mediaBucket: string;
}

export function postsConfigFrom(env: ApiEnv): PostsConfig {
  return {
    mediaPublicUrl: env.MINIO_PUBLIC_URL,
    mediaBucket: env.MINIO_BUCKET,
  };
}
