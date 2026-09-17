import { Inject, Injectable, Logger } from "@nestjs/common";
import { InstagramUnavailableError } from "../common/errors";
import { INSTAGRAM_CONFIG, type InstagramConfig } from "./instagram.config";

/**
 * O **único** lugar que fala com a Meta e o único que anexa o token
 * (AGENTS.md, regra 3; docs/08, "O cliente").
 *
 * Duas responsabilidades que não podem sair daqui:
 *
 * 1. **Anexar o token.** Nenhum serviço de conta, nenhum tratador de fila monta
 *    `access_token=` por conta própria. Um segundo lugar que anexa é um segundo
 *    lugar que pode vazar.
 * 2. **Tirar o token de tudo que vira log ou erro — inclusive da URL.** Os
 *    endpoints de troca e renovação passam `access_token` e `client_secret` na
 *    query string, então higienizar a URL não é zelo: é onde o vazamento
 *    aconteceria. Um erro da Meta costuma devolver de volta o que recebeu.
 *
 * Toda chamada tem tempo limite. Sem ele, uma requisição pendurada segura um
 * tratador de fila até o fim do mundo.
 */
const TIMEOUT_MS = 20_000;

/** Parâmetros que nunca podem aparecer num log, nem parcialmente. */
const SENSITIVE = new Set(["access_token", "client_secret", "code", "input_token"]);

export interface MetaError {
  readonly status: number;
  /** Código numérico da Meta, quando ela manda. É seguro: não é segredo. */
  readonly code: number | null;
  /** Subcódigo, quando existe. É o que distingue "conta não é profissional". */
  readonly subcode: number | null;
  readonly type: string | null;
}

@Injectable()
export class InstagramClient {
  private readonly logger = new Logger("Instagram");

  constructor(@Inject(INSTAGRAM_CONFIG) private readonly config: InstagramConfig) {}

  /** Uma leitura na Graph API, com o token anexado aqui e em nenhum outro lugar. */
  async get<T>(path: string, token: string, query: Record<string, string> = {}): Promise<T> {
    const url = this.graphUrl(path, { ...query, access_token: token });
    return this.request<T>(url, { method: "GET" });
  }

  /** Troca o código da autorização pelo token de curta duração (docs/08, passo 2). */
  async exchangeCode(code: string, redirectUri: string): Promise<{ access_token: string; user_id: string }> {
    const body = new URLSearchParams({
      client_id: this.requireAppId(),
      client_secret: this.requireAppSecret(),
      grant_type: "authorization_code",
      redirect_uri: redirectUri,
      code,
    });

    return this.request(`${this.config.tokenUrl}/oauth/access_token`, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: body.toString(),
    });
  }

  /** Curta duração (1 hora) para longa duração (60 dias) — docs/08, passo 3. */
  async exchangeForLongLived(shortToken: string): Promise<{ access_token: string; expires_in: number }> {
    const url = this.graphUrl("/access_token", {
      grant_type: "ig_exchange_token",
      client_secret: this.requireAppSecret(),
      access_token: shortToken,
    });

    return this.request(url, { method: "GET" });
  }

  /**
   * Renova o token longo por mais 60 dias, contados da renovação (docs/08, passo 4).
   *
   * A Meta exige token com **pelo menos 24 horas de idade** e não expirado. Quem
   * decide quando chamar é a tarefa recorrente, não este método.
   */
  async refreshLongLived(token: string): Promise<{ access_token: string; expires_in: number }> {
    const url = this.graphUrl("/refresh_access_token", {
      grant_type: "ig_refresh_token",
      access_token: token,
    });

    return this.request(url, { method: "GET" });
  }

  private graphUrl(path: string, query: Record<string, string>): string {
    // A versão entra no caminho, menos nos endpoints de token, que não a usam.
    const versioned = path.startsWith("/access_token") || path.startsWith("/refresh_access_token");
    const base = versioned ? this.config.graphUrl : `${this.config.graphUrl}/${this.config.apiVersion}`;
    const url = new URL(base + path);
    for (const [chave, valor] of Object.entries(query)) url.searchParams.set(chave, valor);
    return url.toString();
  }

  private async request<T>(url: string, init: RequestInit): Promise<T> {
    let response: Response;

    try {
      response = await fetch(url, { ...init, signal: AbortSignal.timeout(TIMEOUT_MS) });
    } catch (error) {
      // Nem a URL nem o erro cru entram no log: os dois carregam o token.
      this.logger.error(`Falha ao falar com a Meta em ${safeUrl(url)}: ${kindOf(error)}`);
      throw new InstagramUnavailableError();
    }

    const corpo: unknown = await response.json().catch(() => null);

    if (!response.ok) {
      const erro = readMetaError(corpo, response.status);
      this.logger.warn(
        `A Meta recusou ${safeUrl(url)} — status ${erro.status}, código ${erro.code ?? "?"}, subcódigo ${erro.subcode ?? "?"}`,
      );
      throw new MetaRefusedError(erro);
    }

    return corpo as T;
  }

  private requireAppId(): string {
    if (this.config.appId === null) throw new InstagramUnavailableError();
    return this.config.appId;
  }

  private requireAppSecret(): string {
    if (this.config.appSecret === null) throw new InstagramUnavailableError();
    return this.config.appSecret;
  }
}

/**
 * Recusa da Meta, já sem nada sensível.
 *
 * Não estende `AppError` de propósito: quem sabe traduzir "código 190" em algo
 * que a pessoa entenda é o serviço de OAuth, que conhece o contexto. Sair daqui
 * com erro de usuário pronto acabaria devolvendo mensagem da Meta na tela.
 */
export class MetaRefusedError extends Error {
  constructor(readonly meta: MetaError) {
    super(`A Meta recusou a chamada (status ${meta.status}, código ${meta.code ?? "?"})`);
    this.name = "MetaRefusedError";
  }
}

/** Troca todo parâmetro sensível por `***`, mantendo o resto legível. */
export function safeUrl(raw: string): string {
  try {
    const url = new URL(raw);
    for (const chave of url.searchParams.keys()) {
      if (SENSITIVE.has(chave)) url.searchParams.set(chave, "***");
    }
    return `${url.origin}${url.pathname}${url.search}`;
  } catch {
    return "<endereço inválido>";
  }
}

/** Só o tipo do erro — a mensagem do fetch pode trazer a URL inteira junto. */
function kindOf(error: unknown): string {
  if (error instanceof Error) return error.name === "TimeoutError" ? "tempo esgotado" : error.name;
  return "desconhecido";
}

function readMetaError(corpo: unknown, status: number): MetaError {
  const erro = (corpo as { error?: Record<string, unknown> } | null)?.error ?? {};
  const numero = (valor: unknown): number | null => (typeof valor === "number" ? valor : null);

  return {
    status,
    code: numero(erro["code"]),
    subcode: numero(erro["error_subcode"]),
    type: typeof erro["type"] === "string" ? erro["type"] : null,
  };
}
