import "server-only";

/**
 * O repasse das rotas de máquina do assistente — `/mcp` e o OAuth — à API
 * (ADR 0029, decisão 3; AGENTS.md, exceção da regra 13).
 *
 * Diferente do `apiFetch`, que é das telas: aqui o corpo passa **cru**, o status e o
 * tipo da resposta voltam como vieram, e redirecionamento não é seguido. Só isso — a
 * rota não decide nada; quem decide é a API.
 *
 * ⚠️ **Nunca repassa cookie.** A rota de máquina se identifica só pelo
 * `Authorization: Bearer` do cliente OAuth; um cookie de sessão atravessando daqui
 * transformaria o `/mcp` numa porta de CSRF para quem está logado no navegador.
 */

/** O que atravessa na ida: o necessário ao protocolo, e nada da sessão do navegador. */
const REQUEST_HEADERS = ["accept", "authorization", "content-type", "mcp-protocol-version", "mcp-session-id", "last-event-id"];

/** O que volta ao cliente. `www-authenticate` é o que leva o ChatGPT à descoberta do OAuth. */
const RESPONSE_HEADERS = ["content-type", "cache-control", "www-authenticate", "retry-after", "mcp-session-id"];

export async function apiForward(request: Request, path: string): Promise<Response> {
  const headers = new Headers({ "x-internal-key": process.env.INTERNAL_API_KEY ?? "" });
  for (const name of REQUEST_HEADERS) {
    const value = request.headers.get(name);
    if (value !== null) headers.set(name, value);
  }
  // O IP do visitante vem só do X-Real-IP, definido pelo proxy (regra 15).
  const ip = request.headers.get("x-real-ip");
  if (ip !== null) headers.set("x-real-ip", ip);

  const response = await fetch(`${process.env.INTERNAL_API_URL ?? ""}${path}`, {
    method: request.method,
    headers,
    body: await request.arrayBuffer(),
    redirect: "manual",
    cache: "no-store",
  });

  const back = new Headers();
  for (const name of RESPONSE_HEADERS) {
    const value = response.headers.get(name);
    if (value !== null) back.set(name, value);
  }
  return new Response(await response.arrayBuffer(), { status: response.status, headers: back });
}
