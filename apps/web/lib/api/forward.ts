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

/**
 * O que atravessa na ida: o necessário ao protocolo, e nada da sessão do navegador.
 * Mais **todo `mcp-*`**: o protocolo de 2026-07-28 repete o método num cabeçalho
 * (`Mcp-Method`) e recusa a chamada sem ele — uma lista fixa o descartava, e o
 * ChatGPT ficava sem ferramentas (29/09/2026).
 */
const REQUEST_HEADERS = ["accept", "authorization", "content-type", "last-event-id"];

/** O que volta ao cliente, mais todo `mcp-*`. `www-authenticate` leva o ChatGPT à descoberta do OAuth. */
const RESPONSE_HEADERS = ["content-type", "cache-control", "www-authenticate", "retry-after"];

const isMcpHeader = (name: string) => name.toLowerCase().startsWith("mcp-");

export async function apiForward(request: Request, path: string): Promise<Response> {
  const body = await request.arrayBuffer();
  const headers = new Headers({ "x-internal-key": process.env.INTERNAL_API_KEY ?? "" });
  request.headers.forEach((value, name) => {
    if (REQUEST_HEADERS.includes(name) || isMcpHeader(name)) headers.set(name, value);
  });
  // Sondagem sem corpo (o ChatGPT manda uma, como octet-stream): sem o tipo, ela chega
  // à API e recebe o 401 que aponta a descoberta, e não um 415 do Fastify.
  if (body.byteLength === 0) headers.delete("content-type");
  // O IP do visitante vem só do X-Real-IP, definido pelo proxy (regra 15).
  const ip = request.headers.get("x-real-ip");
  if (ip !== null) headers.set("x-real-ip", ip);

  const response = await fetch(`${process.env.INTERNAL_API_URL ?? ""}${path}`, {
    method: request.method,
    headers,
    body,
    redirect: "manual",
    cache: "no-store",
  });

  const back = new Headers();
  response.headers.forEach((value, name) => {
    if (RESPONSE_HEADERS.includes(name) || isMcpHeader(name)) back.set(name, value);
  });
  return new Response(await response.arrayBuffer(), { status: response.status, headers: back });
}
