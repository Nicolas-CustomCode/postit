import { Inject, Injectable, Logger } from "@nestjs/common";
import { z } from "zod";
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

/** Marca de "a resposta não era JSON", distinta de um JSON que é `null`. */
const SEM_JSON = Symbol("sem-json");

/**
 * O que esperamos da Meta nos dois passos de token.
 *
 * `passthrough` de propósito: a Meta acrescenta campos com o tempo, e recusar
 * uma resposta por trazer campo a mais quebraria a conexão sem motivo. O que
 * conferimos é o que **usamos**.
 */
const shortLivedTokenSchema = z.object({ access_token: z.string().min(1) }).loose();
const longLivedTokenSchema = z
  .object({ access_token: z.string().min(1), expires_in: z.number().int().positive() })
  .loose();

export type ShortLivedToken = z.infer<typeof shortLivedTokenSchema>;
export type LongLivedToken = z.infer<typeof longLivedTokenSchema>;

export interface RequestOptions {
  /**
   * Tempo limite desta chamada. O padrão serve para leitura; o `media_publish`
   * pede mais, porque é justamente nele que desistir cedo cria a ambiguidade de
   * "publicou ou não?" (docs/09, "O caso difícil").
   */
  readonly timeoutMs?: number;
}

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
  async get<T>(
    path: string,
    token: string,
    query: Record<string, string> = {},
    options: RequestOptions = {},
  ): Promise<T> {
    const url = this.graphUrl(path, { ...query, access_token: token });
    return this.request<T>(url, { method: "GET" }, options.timeoutMs, token);
  }

  /**
   * Uma escrita na Graph API — containers e `media_publish` (docs/08, "Publicação
   * em duas etapas").
   *
   * O token vai no cabeçalho, e não na URL, como no guia de publicação do
   * Instagram Login: fica fora de qualquer endereço que um proxy ou log registre.
   */
  async post<T>(path: string, token: string, body: Record<string, unknown>, options: RequestOptions = {}): Promise<T> {
    return this.request<T>(
      this.graphUrl(path, {}),
      {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
        body: JSON.stringify(body),
      },
      options.timeoutMs,
      token,
    );
  }

  /** Troca o código da autorização pelo token de curta duração (docs/08, passo 2). */
  async exchangeCode(code: string, redirectUri: string): Promise<ShortLivedToken> {
    const body = new URLSearchParams({
      client_id: this.requireAppId(),
      client_secret: this.requireAppSecret(),
      grant_type: "authorization_code",
      redirect_uri: redirectUri,
      code,
    });

    const corpo = await this.request(`${this.config.tokenUrl}/oauth/access_token`, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: body.toString(),
    });

    return this.parse(shortLivedTokenSchema, corpo, "troca do código");
  }

  /** Curta duração (1 hora) para longa duração (60 dias) — docs/08, passo 3. */
  async exchangeForLongLived(shortToken: string): Promise<LongLivedToken> {
    const url = this.graphUrl("/access_token", {
      grant_type: "ig_exchange_token",
      client_secret: this.requireAppSecret(),
      access_token: shortToken,
    });

    return this.parse(longLivedTokenSchema, await this.request(url, { method: "GET" }), "token de longa duração");
  }

  /**
   * Renova o token longo por mais 60 dias, contados da renovação (docs/08, passo 4).
   *
   * A Meta exige token com **pelo menos 24 horas de idade** e não expirado. Quem
   * decide quando chamar é a tarefa recorrente, não este método.
   */
  async refreshLongLived(token: string): Promise<LongLivedToken> {
    const url = this.graphUrl("/refresh_access_token", {
      grant_type: "ig_refresh_token",
      access_token: token,
    });

    return this.parse(longLivedTokenSchema, await this.request(url, { method: "GET" }), "renovação do token");
  }

  /**
   * Confere o que a Meta devolveu antes de deixar entrar.
   *
   * A borda de ENTRADA do projeto já tem esse rigor, com o `ZodValidationPipe`;
   * a de saída não tinha. Sem isto, um `expires_in` ausente virava
   * `agora + undefined` — uma data inválida que só estoura lá adiante, no
   * Prisma, como erro de servidor sem relação aparente com a Meta.
   */
  private parse<T>(schema: z.ZodType<T>, corpo: unknown, oQue: string): T {
    const resultado = schema.safeParse(corpo);
    if (resultado.success) return resultado.data;

    // Só os NOMES dos campos problemáticos — os valores são o token.
    const campos = resultado.error.issues.map((issue) => issue.path.join(".")).join(", ");
    this.logger.error(`A Meta devolveu uma resposta inesperada na ${oQue}. Campos: ${campos || "(corpo inteiro)"}`);
    throw new MetaRefusedError({ status: 200, code: null, subcode: null, type: null });
  }

  private graphUrl(path: string, query: Record<string, string>): string {
    // Os endpoints de token são os únicos SEM a versão no caminho.
    const semVersao = path.startsWith("/access_token") || path.startsWith("/refresh_access_token");
    const base = semVersao ? this.config.graphUrl : `${this.config.graphUrl}/${this.config.apiVersion}`;
    const url = new URL(base + path);
    for (const [chave, valor] of Object.entries(query)) url.searchParams.set(chave, valor);
    return url.toString();
  }

  private async request<T>(url: string, init: RequestInit, timeoutMs = TIMEOUT_MS, token?: string): Promise<T> {
    let response: Response;

    try {
      response = await fetch(url, { ...init, signal: AbortSignal.timeout(timeoutMs) });
    } catch (error) {
      // Nem a URL nem o erro cru entram no log: os dois carregam o token.
      this.logger.error(`Falha ao falar com a Meta em ${safeUrl(url)}: ${kindOf(error)}`);
      throw new InstagramUnavailableError();
    }

    // `null` distingue "não veio JSON" de "veio JSON nulo": a diferença importa
    // logo abaixo, e `catch(() => null)` sozinho confundiria os dois.
    const corpo: unknown = await response.json().catch(() => SEM_JSON);

    if (!response.ok) {
      const erro = readMetaError(corpo, response.status);
      this.logger.warn(
        `A Meta recusou ${safeUrl(url)} — status ${erro.status}, código ${erro.code ?? "?"}, subcódigo ${erro.subcode ?? "?"}`,
      );
      throw new MetaRefusedError(erro, readMetaDetail(corpo, token));
    }

    /*
     * Resposta 200 sem JSON é página de manutenção, portal de rede ou proxy
     * corporativo — não é a Meta. Sem esta recusa, o `corpo` viraria `undefined`
     * e o erro só apareceria lá adiante, como "não consigo ler uma propriedade
     * de undefined", longe da causa.
     */
    if (corpo === SEM_JSON) {
      this.logger.error(`A Meta respondeu ${response.status} sem JSON em ${safeUrl(url)}`);
      throw new MetaRefusedError({ status: response.status, code: null, subcode: null, type: null });
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
  /**
   * @param detail o corpo do erro como a Meta mandou, já sem o token. Existe para a
   *   auditoria da publicação (RF-F09, "o erro cru da Meta") e **só** para ela:
   *   nunca vai para log, resposta ou tela.
   */
  constructor(
    readonly meta: MetaError,
    readonly detail: MetaErrorDetail | null = null,
  ) {
    super(`A Meta recusou a chamada (status ${meta.status}, código ${meta.code ?? "?"})`);
    this.name = "MetaRefusedError";
  }
}

/** Os campos de erro que a Graph API documenta, e só eles. */
export interface MetaErrorDetail {
  readonly message?: string;
  readonly type?: string;
  readonly code?: number;
  readonly error_subcode?: number;
  readonly error_user_title?: string;
  readonly error_user_msg?: string;
  readonly fbtrace_id?: string;
}

const DETAIL_TEXT_FIELDS = ["message", "type", "error_user_title", "error_user_msg", "fbtrace_id"] as const;
const DETAIL_NUMBER_FIELDS = ["code", "error_subcode"] as const;

/**
 * Copia do corpo do erro só os campos conhecidos, e tira deles o token.
 *
 * Lista fechada em vez de cópia inteira: um campo novo que a Meta acrescente
 * não entra na auditoria sem alguém olhar o que ele traz. E o token sai de todo
 * texto — pelo valor, quando se sabe qual foi usado, e por qualquer
 * `access_token=` que a Meta ecoe de volta.
 */
function readMetaDetail(corpo: unknown, token: string | undefined): MetaErrorDetail | null {
  const erro = (corpo as { error?: Record<string, unknown> } | null)?.error;
  if (erro === undefined || erro === null || typeof erro !== "object") return null;

  const limpa = (texto: string): string => {
    const semParametro = texto.replace(/access_token=[^&\s"']+/g, "access_token=***");
    return token ? semParametro.split(token).join("***") : semParametro;
  };

  const detail: Record<string, string | number> = {};
  for (const campo of DETAIL_TEXT_FIELDS) {
    const valor = erro[campo];
    if (typeof valor === "string") detail[campo] = limpa(valor);
  }
  for (const campo of DETAIL_NUMBER_FIELDS) {
    const valor = erro[campo];
    if (typeof valor === "number") detail[campo] = valor;
  }
  return detail as MetaErrorDetail;
}

/** Troca todo parâmetro sensível por `***`, mantendo o resto legível. */
export function safeUrl(raw: string): string {
  try {
    const url = new URL(raw);
    // Percorre uma CÓPIA das chaves: `set` altera a coleção, e alterar enquanto
    // se percorre pode fazer o laço pular uma entrada — a pulada sairia em claro
    // no log, que é exatamente o que esta função existe para impedir.
    for (const chave of [...url.searchParams.keys()]) {
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
