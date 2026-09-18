import { decodeEncryptionKey } from "../common/crypto";
import type { ApiEnv, WorkerEnv } from "../config/env";

/**
 * O que o módulo do Instagram precisa saber do ambiente.
 *
 * Injetado por token, como o `ACCOUNTS_CONFIG` e o `AUTH_CONFIG`: **nenhum
 * serviço lê `process.env`**. É isso que permite o teste apontar para a Meta
 * falsa sem mexer no processo inteiro.
 *
 * Os três endereços vêm separados porque a Meta os separa — autorização no
 * `instagram.com`, troca do código no `api.instagram.com`, o resto no
 * `graph.instagram.com` (docs/08, "Fluxo de autorização").
 */
export const INSTAGRAM_CONFIG = Symbol("INSTAGRAM_CONFIG");

export interface InstagramConfig {
  readonly appId: string | null;
  readonly appSecret: string | null;
  readonly apiVersion: string;
  readonly authUrl: string;
  readonly tokenUrl: string;
  readonly graphUrl: string;
  /** Só a API faz OAuth; no worker estes dois são nulos, e ele nunca precisa. */
  readonly redirectUri: string | null;
  readonly stateSecret: Buffer | null;
  /**
   * A mesma chave do `ACCOUNTS_CONFIG`, decodificada aqui em vez de importada de
   * lá: a renovação de token roda no worker, que não tem módulo de contas. É o
   * mesmo motivo pelo qual o `ACCOUNTS_CONFIG` não a importa do `AUTH_CONFIG`.
   */
  readonly encryptionKey: Buffer;
}

export function instagramConfigFrom(env: ApiEnv | WorkerEnv): InstagramConfig {
  return {
    appId: env.IG_APP_ID ?? null,
    appSecret: env.IG_APP_SECRET ?? null,
    apiVersion: env.IG_API_VERSION,
    authUrl: trimSlash(env.META_AUTH_URL),
    tokenUrl: trimSlash(env.META_TOKEN_URL),
    graphUrl: trimSlash(env.META_GRAPH_URL),
    redirectUri: "IG_REDIRECT_URI" in env ? (env.IG_REDIRECT_URI ?? null) : null,
    stateSecret: "STATE_SECRET" in env ? Buffer.from(env.STATE_SECRET, "hex") : null,
    encryptionKey: decodeEncryptionKey(env.ENCRYPTION_KEY),
  };
}

const trimSlash = (url: string): string => url.replace(/\/$/, "");
