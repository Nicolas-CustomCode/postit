import "server-only";
import { headers } from "next/headers";
import { AUTH_ERROR_MESSAGES, type ApiErrorBody, type AuthErrorCode } from "@repo/shared";

/**
 * A única forma de falar com a API (AGENTS.md, regra 4).
 *
 * `import "server-only"` é a primeira linha por um motivo: se um componente de
 * cliente importar este módulo por engano, o **build quebra**, em vez de a chave
 * interna ir para o navegador.
 */

/** Erro vindo da API, já com o código do vocabulário fechado de @repo/shared. */
export class ApiError extends Error {
  constructor(
    readonly code: AuthErrorCode,
    readonly status: number,
    readonly blockedUntil?: string,
    readonly fields?: readonly string[],
    /** Só em POST_VERSION_CONFLICT: quem salvou antes, e quando (RF-C12). */
    readonly conflict?: ApiErrorBody["conflict"],
  ) {
    super(AUTH_ERROR_MESSAGES[code]);
    this.name = "ApiError";
  }
}

export interface ApiRequest {
  readonly method: "GET" | "POST";
  readonly path: string;
  readonly body?: unknown;
  /** Token da sessão. Quem tem o cookie é o Next; a API só conhece o Bearer. */
  readonly token?: string | null;
}

export async function apiFetch<T>({ method, path, body, token }: ApiRequest): Promise<T> {
  const incoming = await headers();

  const response = await fetch(`${process.env.INTERNAL_API_URL ?? ""}${path}`, {
    method,
    headers: {
      // ⚠️ Só quando há corpo: com `content-type: application/json` e corpo
      // vazio, o Fastify recusa a requisição com 400 antes de qualquer rota.
      // Era o que fazia o "Sair" parecer funcionar — o cookie sumia da tela e a
      // sessão continuava válida no banco.
      ...(body === undefined ? {} : { "content-type": "application/json" }),
      // Sem esta chave, a API recusa qualquer rota — inclusive as públicas.
      "x-internal-key": process.env.INTERNAL_API_KEY ?? "",
      /*
       * O IP e o navegador de quem está do outro lado precisam ser repassados:
       * para a API, o socket é sempre 127.0.0.1 e o user-agent é sempre o do
       * Node. Sem isto, toda tentativa de acesso ficaria registrada com a mesma
       * evidência, o que é o mesmo que não registrar nenhuma.
       *
       * Lemos SÓ X-Real-IP: o X-Forwarded-For é uma lista que o próprio
       * visitante pode começar a preencher (docs/11).
       */
      ...(incoming.get("x-real-ip") === null ? {} : { "x-real-ip": incoming.get("x-real-ip") as string }),
      ...(incoming.get("user-agent") === null ? {} : { "x-client-user-agent": incoming.get("user-agent") as string }),
      ...(token === undefined || token === null ? {} : { authorization: `Bearer ${token}` }),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    // Nunca guardar resposta: um cache aqui serviria a resposta de uma pessoa
    // para outra, que é o pior defeito possível num BFF.
    cache: "no-store",
  });

  if (response.status === 204) return undefined as T;

  const payload = (await response.json().catch(() => null)) as ApiErrorBody | T | null;

  if (!response.ok) {
    const error = (payload ?? {}) as Partial<ApiErrorBody>;
    throw new ApiError(
      error.code ?? "INTERNAL_ERROR",
      response.status,
      error.blockedUntil,
      error.fields,
      error.conflict,
    );
  }

  return payload as T;
}
