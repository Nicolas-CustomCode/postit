import type { FastifyRequest } from "fastify";

/**
 * De onde vêm o IP e o navegador de quem está do outro lado.
 *
 * ⚠️ **Só `X-Real-IP`** (docs/11, "O IP real do visitante"). `X-Forwarded-For` é
 * uma lista que o próprio visitante pode começar a preencher: usá-la é aceitar o
 * IP que o atacante escolheu, e aí o bloqueio por IP deixa de bloquear.
 *
 * Isto é confiável porque o Next escuta só em 127.0.0.1, o proxy sobrescreve o
 * cabeçalho, e a API só aceita chamada de quem apresentou a chave interna.
 *
 * `request.ip` do Fastify não serve: com `trustProxy: false` ele é sempre o
 * endereço do Next.
 */
export const CLIENT_IP_HEADER = "x-real-ip";
export const CLIENT_USER_AGENT_HEADER = "x-client-user-agent";

/** O cabeçalho repetido chega como lista; nesse caso ninguém sabe qual vale. */
function single(value: string | string[] | undefined): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length === 0 ? null : trimmed;
}

export function clientIp(request: FastifyRequest): string | null {
  return single(request.headers[CLIENT_IP_HEADER]);
}

/**
 * O navegador aparece na tela de sessões ativas. Truncado porque é texto livre
 * vindo de fora, e a coluna não precisa guardar mais do que isso.
 */
export function clientUserAgent(request: FastifyRequest): string | null {
  const value = single(request.headers[CLIENT_USER_AGENT_HEADER]) ?? single(request.headers["user-agent"]);
  return value === null ? null : value.slice(0, 255);
}

/**
 * O token da sessão vem em `Authorization: Bearer`, nunca em cookie: é isso que
 * mantém a API sem CORS, sem CSRF e sem SameSite para configurar. Quem guarda o
 * cookie é o Next.
 */
export function bearerToken(request: FastifyRequest): string | null {
  const header = single(request.headers.authorization);
  if (header === null || !header.startsWith("Bearer ")) return null;
  const token = header.slice("Bearer ".length).trim();
  return token.length === 0 ? null : token;
}

export interface ClientContext {
  readonly ip: string | null;
  readonly userAgent: string | null;
}

export function clientContext(request: FastifyRequest): ClientContext {
  return { ip: clientIp(request), userAgent: clientUserAgent(request) };
}
