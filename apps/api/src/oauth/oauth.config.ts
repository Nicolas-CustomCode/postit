import type { ApiEnv } from "../config/env";

/**
 * O PostIt como servidor OAuth do assistente (ADR 0029). O endereço público é o do
 * Next — `APP_URL` —, que só repassa à API: é ele o emissor, e o `/mcp` dele é o
 * único recurso que um token vale.
 */
export const OAUTH_CONFIG = "OAUTH_CONFIG";

export interface OAuthConfig {
  /** `APP_URL` sem barra final. Vai no `iss` do retorno (RFC 9207) e nos metadados. */
  readonly issuer: string;
  /** O `/mcp` público: o indicador de recurso (RFC 8707) de todo token. */
  readonly resource: string;
  /** Os mesmos prazos da sessão (ADR 0029, decisão 4). */
  readonly idleDays: number;
  readonly maxDays: number;
}

export function oauthConfigFrom(env: ApiEnv): OAuthConfig {
  const issuer = env.APP_URL.replace(/\/+$/, "");
  return { issuer, resource: `${issuer}/mcp`, idleDays: env.SESSION_IDLE_DAYS, maxDays: env.SESSION_MAX_DAYS };
}
