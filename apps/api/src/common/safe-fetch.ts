import { lookup as dnsLookup, type LookupAddress } from "node:dns";
import { request } from "node:https";
import { BlockList, isIP, type LookupFunction } from "node:net";

/**
 * Busca de um endereço informado por terceiro — a ficha do cliente OAuth (CIMD) e a
 * imagem que o assistente manda baixar (ADR 0029, decisão 5; docs/11).
 *
 * É a porta de SSRF do projeto: sem estas travas, um endereço como
 * `https://169.254.169.254/` ou um domínio que resolve para `10.0.0.5` faria a API
 * buscar, de dentro da rede do servidor, o que a internet não alcança.
 *
 *  - só https;
 *  - o IP é conferido **no momento da conexão**, pelo `lookup` do próprio pedido: o
 *    DNS que responde um IP público na conferência e um privado na conexão (DNS
 *    rebinding) não passa, porque não há duas resoluções;
 *  - redirecionamento só com `maxRedirects`, e cada salto é uma busca nova, com
 *    todas estas travas de novo — o destino de um 302 é outro endereço de terceiro;
 *  - teto de tamanho e de tempo, contando o corpo enquanto chega.
 *
 * A mensagem de erro nunca traz a URL: a de download do ChatGPT carrega credencial
 * (regra 3). Quem chama diz o que estava buscando.
 */

export class SafeFetchError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SafeFetchError";
  }
}

export interface SafeFetchOptions {
  readonly maxBytes: number;
  readonly timeoutMs: number;
  readonly accept?: string;
  /**
   * Quantos redirecionamentos seguir. Padrão 0: a ficha do CIMD não segue nenhum. O
   * download de imagem segue poucos, porque link de download costuma levar a um
   * armazenamento assinado.
   */
  readonly maxRedirects?: number;
}

export interface SafeFetchResult {
  readonly contentType: string | null;
  readonly body: Buffer;
}

/** Faixas que não são internet pública (RFC 6890 e o registro de endereços especiais da IANA). */
const BLOCKED = new BlockList();
for (const [network, prefix] of [
  ["0.0.0.0", 8],
  ["10.0.0.0", 8],
  ["100.64.0.0", 10],
  ["127.0.0.0", 8],
  ["169.254.0.0", 16],
  ["172.16.0.0", 12],
  ["192.0.0.0", 24],
  ["192.0.2.0", 24],
  ["192.168.0.0", 16],
  ["198.18.0.0", 15],
  ["198.51.100.0", 24],
  ["203.0.113.0", 24],
  ["224.0.0.0", 4],
  ["240.0.0.0", 4],
] as const) {
  BLOCKED.addSubnet(network, prefix, "ipv4");
}
for (const [network, prefix] of [
  ["::", 128],
  ["::1", 128],
  // NAT64 esconde um IPv4 qualquer; servidor público não responde assim.
  ["64:ff9b::", 96],
  ["100::", 64],
  ["2001:db8::", 32],
  ["fc00::", 7],
  ["fe80::", 10],
  ["ff00::", 8],
] as const) {
  BLOCKED.addSubnet(network, prefix, "ipv6");
}

export function isPublicAddress(address: string): boolean {
  const family = isIP(address);
  if (family === 0) return false;
  // IPv4 mapeado em IPv6 também esconde um IPv4 qualquer. Não vai como faixa no
  // BlockList porque ele confere todo IPv4 contra ela, e recusaria a internet inteira.
  if (family === 6 && address.toLowerCase().startsWith("::ffff:")) return false;
  return !BLOCKED.check(address, family === 4 ? "ipv4" : "ipv6");
}

/**
 * Resolve o nome e só entrega à conexão um endereço público. Com vários endereços,
 * basta um privado para recusar: não há como garantir em qual a conexão cairia.
 */
const publicOnlyLookup: LookupFunction = (hostname, options, callback) => {
  dnsLookup(hostname, { ...options, all: true }, (error, addresses: LookupAddress[]) => {
    if (error) return callback(error, "", 0);
    if (addresses.length === 0 || !addresses.every((a) => isPublicAddress(a.address))) {
      return callback(new SafeFetchError("o endereço não é público"), "", 0);
    }
    const chosen = addresses[0]!;
    if (options.all) return callback(null, [chosen] as unknown as string, chosen.family);
    return callback(null, chosen.address, chosen.family);
  });
};

/**
 * O endereço do próximo salto. Relativo resolve contra o atual; o resultado passa
 * pelas mesmas travas do primeiro, na busca seguinte — aqui só se recusa o que já
 * dá para recusar sem conectar.
 */
export function nextHop(current: string, location: string | null): string {
  if (location === null || location.trim() === "") throw new SafeFetchError("redirecionamento sem destino");
  let next: URL;
  try {
    next = new URL(location, current);
  } catch {
    throw new SafeFetchError("redirecionamento inválido");
  }
  if (next.protocol !== "https:") throw new SafeFetchError("só https");
  return next.toString();
}

export async function safeFetch(rawUrl: string, options: SafeFetchOptions): Promise<SafeFetchResult> {
  // Um prazo só para a corrente inteira: cada salto gasta do mesmo tempo.
  const deadline = Date.now() + options.timeoutMs;
  let current = rawUrl;

  for (let saltos = 0; ; saltos += 1) {
    const result = await fetchOnce(current, options, Math.max(1, deadline - Date.now()));
    if (!("location" in result)) return result;
    if (saltos >= (options.maxRedirects ?? 0)) {
      throw new SafeFetchError(options.maxRedirects === undefined ? "redirecionamento não é seguido" : "redirecionamentos demais");
    }
    current = nextHop(current, result.location);
  }
}

function fetchOnce(
  rawUrl: string,
  options: SafeFetchOptions,
  timeoutMs: number,
): Promise<SafeFetchResult | { location: string | null }> {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    return Promise.reject(new SafeFetchError("endereço inválido"));
  }
  if (url.protocol !== "https:") return Promise.reject(new SafeFetchError("só https"));
  if (url.username !== "" || url.password !== "") {
    return Promise.reject(new SafeFetchError("endereço com credenciais"));
  }
  // IP escrito direto na URL não passa pelo lookup: confere aqui.
  const literal = url.hostname.replace(/^\[|\]$/g, "");
  if (isIP(literal) !== 0 && !isPublicAddress(literal)) {
    return Promise.reject(new SafeFetchError("o endereço não é público"));
  }

  return new Promise((resolve, reject) => {
    const fail = (error: Error) => {
      req.destroy();
      reject(error instanceof SafeFetchError ? error : new SafeFetchError("falha de rede"));
    };

    const req = request(
      url,
      {
        method: "GET",
        lookup: publicOnlyLookup,
        headers: { accept: options.accept ?? "*/*", "user-agent": "PostIt" },
        signal: AbortSignal.timeout(timeoutMs),
      },
      (res) => {
        const status = res.statusCode ?? 0;
        if (status >= 300 && status < 400) {
          // Quem decide se segue é o `safeFetch`; aqui só se fecha esta conexão.
          const location = res.headers.location ?? null;
          req.destroy();
          return resolve({ location });
        }
        if (status < 200 || status >= 300) return fail(new SafeFetchError(`o servidor respondeu ${status}`));

        const declared = Number(res.headers["content-length"]);
        if (Number.isFinite(declared) && declared > options.maxBytes) {
          return fail(new SafeFetchError("maior que o limite"));
        }

        const chunks: Buffer[] = [];
        let received = 0;
        res.on("data", (chunk: Buffer) => {
          received += chunk.length;
          if (received > options.maxBytes) return fail(new SafeFetchError("maior que o limite"));
          chunks.push(chunk);
        });
        res.on("end", () => resolve({ contentType: res.headers["content-type"] ?? null, body: Buffer.concat(chunks) }));
        res.on("error", fail);
      },
    );
    req.on("error", (error) => fail(error.name === "AbortError" ? new SafeFetchError("tempo esgotado") : error));
    req.end();
  });
}
