import { Inject, Injectable, Logger } from "@nestjs/common";
import { McpServer, type CallToolResult } from "@modelcontextprotocol/server";
import {
  ALT_TEXT_MAX_LENGTH,
  AUTH_ERROR_MESSAGES,
  CAPTION_MAX_HASHTAGS,
  CAPTION_MAX_LENGTH,
  CAPTION_MAX_MENTIONS,
  CAPTION_SANITY_LIMIT,
  COMPOSABLE_FORMATS,
  formatsFor,
  IMAGE_FORMATS,
  IMAGE_MAX_BYTES,
  IMAGE_MIN_WIDTH,
  IMAGE_SPECS,
  isImageFormat,
  POST_FORMAT_LABELS,
  POST_MEDIA_COUNT,
  POST_MEDIA_MAX,
  POST_STATUS_LABELS,
  postMediaCountProblem,
  VERSION,
  type ComposableFormat,
  type PostDetail,
} from "@repo/shared";
import { z } from "zod";
import { AccountsQueryService } from "../accounts/accounts.query.service";
import { AppError } from "../common/errors";
import { SafeFetchError } from "../common/safe-fetch";
import { postProblems } from "../domain/post/post-readiness";
import { MediaDomainService } from "../media/media.domain.service";
import { MediaQueryService } from "../media/media.query.service";
import type { AssistantAccess } from "../oauth/oauth.service";
import { OAUTH_CONFIG, type OAuthConfig } from "../oauth/oauth.config";
import { PostsDomainService } from "../posts/posts.domain.service";
import { PostsQueryService } from "../posts/posts.query.service";
import { ImageDownloader } from "./image-downloader";

/**
 * O que o assistente lê antes de chamar qualquer ferramenta. Nome PostIt, nunca
 * "Insta", "gram" ou "IG" (ADR 0016).
 */
const INSTRUCTIONS = [
  "PostIt é o agendador de postagens da equipe. Por aqui você só compõe rascunhos:",
  "quem envia para revisão, aprova e agenda é uma pessoa, pela tela do PostIt.",
  "Antes de compor, consulte ver_regras — os limites são os que a tela confere.",
  "As imagens vêm do acervo (listar_acervo); imagem nova entra por enviar_imagem.",
  "Escreva texto alternativo para cada uma.",
].join(" ");

/**
 * As regras de imagem em frase, para quem **gera** a imagem acertar de primeira. O
 * gerador do ChatGPT entrega PNG e oferece retrato 2:3, que o Feed recusa (a faixa
 * vai de 4:5 a 1.91:1) — dizer isso na descrição evita a ida e volta.
 */
const IMAGE_GUIDANCE = [
  `Só JPEG, até ${IMAGE_MAX_BYTES / 1_000_000} MB, com ${IMAGE_MIN_WIDTH} px de largura ou mais.`,
  "Se a imagem for PNG, WebP ou outro formato — inclusive a que você gerou —, converta para JPEG antes de enviar.",
  `Feed aceita proporção de ${IMAGE_SPECS.FEED.ratioLabel ?? ""}: gere quadrada (1:1) ou paisagem;`,
  "retrato vertical 2:3 não serve ao Feed. Stories aceita qualquer proporção; 9:16 é o ideal.",
].join(" ");

const imagesInput = z
  .array(
    z.object({
      id: z.uuid().describe("id da imagem no acervo (listar_acervo)"),
      textoAlternativo: z
        .string()
        .max(ALT_TEXT_MAX_LENGTH)
        .optional()
        .describe("descrição da foto para quem usa leitor de tela"),
    }),
  )
  .max(POST_MEDIA_MAX)
  .describe("na ordem do carrossel; a primeira define o quadro");

/** Recusa que volta ao assistente como resultado de ferramenta, com a frase para a pessoa. */
class ToolRefusal extends Error {}

const NOT_FOUND = "Rascunho não encontrado entre os que você compôs para esta pessoa.";

/**
 * As ferramentas do assistente (docs/16). Uma instância de servidor por chamada,
 * presa a quem é dono do token: nenhuma ferramenta recebe o usuário como
 * parâmetro, então o assistente não tem como agir em nome de outra pessoa.
 *
 * Toda escrita passa pelos serviços de domínio, com as mesmas regras da tela —
 * nunca pelo Prisma direto (o `architecture.spec` confere). E **nenhuma muda
 * status**: o rascunho só sai de `RASCUNHO` pela mão de uma pessoa (ADR 0029).
 */
@Injectable()
export class McpToolsService {
  private readonly logger = new Logger("MCP");

  constructor(
    private readonly accounts: AccountsQueryService,
    private readonly media: MediaQueryService,
    private readonly mediaDomain: MediaDomainService,
    private readonly downloader: ImageDownloader,
    private readonly posts: PostsDomainService,
    private readonly postsQuery: PostsQueryService,
    @Inject(OAUTH_CONFIG) private readonly config: OAuthConfig,
  ) {}

  createServer(access: AssistantAccess): McpServer {
    const server = new McpServer({ name: "PostIt", version: VERSION }, { instructions: INSTRUCTIONS });
    const run = (name: string, fn: () => Promise<unknown>) => this.run(name, fn);

    server.registerTool(
      "listar_contas",
      {
        title: "Listar contas",
        description: "As contas conectadas ao PostIt, com o @ de cada uma e o fuso horário.",
        annotations: { readOnlyHint: true },
      },
      () =>
        run("listar_contas", async () => {
          const accounts = await this.accounts.list(new Date());
          return {
            contas: accounts.map((account) => ({
              usuario: `@${account.username}`,
              nome: account.name,
              fuso: account.timezone,
            })),
          };
        }),
    );

    server.registerTool(
      "ver_regras",
      {
        title: "Ver regras",
        description:
          "Os limites que o rascunho precisa respeitar: legenda, quantidade de imagens e proporções aceitas por formato.",
        inputSchema: z.object({
          formato: z.enum(IMAGE_FORMATS).optional().describe("FEED ou STORIES; sem ele, os dois"),
        }),
        annotations: { readOnlyHint: true },
      },
      ({ formato }) =>
        run("ver_regras", () => {
          const formats = formato === undefined ? IMAGE_FORMATS : [formato];
          return Promise.resolve({
            legenda: {
              maximoCaracteres: CAPTION_MAX_LENGTH,
              maximoHashtags: CAPTION_MAX_HASHTAGS,
              maximoMencoes: CAPTION_MAX_MENTIONS,
            },
            formatos: formats.map((format) => {
              const spec = IMAGE_SPECS[format];
              return {
                formato: format,
                imagens: POST_MEDIA_COUNT[format],
                arquivo: `JPEG de até ${spec.maxBytes / 1_000_000} MB, com ${spec.minWidth} px de largura ou mais`,
                proporcao: spec.ratioLabel ?? "qualquer (9:16 recomendado)",
              };
            }),
            observacoes: [
              "No Feed, de 2 a 10 imagens viram um carrossel.",
              "Toda imagem deve ter texto alternativo, que descreve a foto para quem usa leitor de tela.",
              "Imagem fora da proporção do formato entra no rascunho marcada para ajuste; o recorte é feito por uma pessoa, na tela.",
              IMAGE_GUIDANCE,
            ],
          });
        }),
    );

    server.registerTool(
      "listar_acervo",
      {
        title: "Listar acervo",
        description:
          "As imagens do acervo, as mais recentes primeiro, com as medidas, os formatos que cada uma aceita sem ajuste e um link de prévia.",
        annotations: { readOnlyHint: true },
      },
      () =>
        run("listar_acervo", async () => {
          const imagens = await this.media.list();
          return {
            imagens: imagens.map((imagem) => ({
              id: imagem.id,
              largura: imagem.width,
              altura: imagem.height,
              serveA: formatsFor(imagem.width, imagem.height),
              previa: imagem.url,
              enviadaEm: imagem.createdAt,
            })),
          };
        }),
    );

    server.registerTool(
      "enviar_imagem",
      {
        title: "Enviar imagem",
        description: `Põe no acervo do PostIt uma imagem nova: a que a pessoa anexou na conversa, ou uma URL https. Devolve o id para usar em criar_rascunho ou editar_rascunho. ${IMAGE_GUIDANCE}`,
        inputSchema: z.object({
          arquivo: z
            .object({
              download_url: z.string().max(4096),
              file_id: z.string().max(512),
              mime_type: z.string().max(128).optional(),
              file_name: z.string().max(512).optional(),
            })
            .optional()
            .describe("a imagem anexada na conversa"),
          url: z.string().max(4096).optional().describe("ou o endereço https da imagem"),
        }),
        annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false },
        // O ChatGPT troca o anexo por um link de download neste campo (referência do Apps SDK).
        _meta: { "openai/fileParams": ["arquivo"] },
      },
      (input) => run("enviar_imagem", () => this.uploadImage(input)),
    );

    server.registerTool(
      "criar_rascunho",
      {
        title: "Criar rascunho",
        description: `Cria um rascunho numa conta, com legenda e imagens do acervo. Ele fica marcado como composto pelo assistente, e uma pessoa o confere e envia para revisão pela tela. Imagem fora da proporção do formato entra marcada para ajuste na tela. Feed aceita de ${IMAGE_SPECS.FEED.ratioLabel ?? ""} (retrato 2:3 não serve); Stories, qualquer proporção.`,
        inputSchema: z.object({
          conta: z.string().min(1).max(64).describe("o @ da conta, como listar_contas devolve"),
          formato: z.enum(COMPOSABLE_FORMATS).describe("FEED (imagem ou carrossel) ou STORIES"),
          // O teto da tela: os 2.200 são problema de prontidão, não de gravação (RF-C03).
          legenda: z.string().max(CAPTION_SANITY_LIMIT).optional(),
          imagens: imagesInput.optional(),
        }),
        annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false },
      },
      (input) => run("criar_rascunho", () => this.createDraft(access, input)),
    );

    server.registerTool(
      "editar_rascunho",
      {
        title: "Editar rascunho",
        description:
          "Muda legenda, formato ou imagens de um rascunho que você compôs. Só o que for informado muda; imagens substituem a lista inteira. Exige a versão lida por último.",
        inputSchema: z.object({
          id: z.uuid(),
          versao: z.number().int().positive().describe("a versão devolvida pela última leitura ou escrita"),
          legenda: z.string().max(CAPTION_SANITY_LIMIT).nullable().optional().describe("null apaga a legenda"),
          formato: z.enum(COMPOSABLE_FORMATS).optional(),
          imagens: imagesInput.optional(),
        }),
        annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false },
      },
      (input) => run("editar_rascunho", () => this.editDraft(access, input)),
    );

    server.registerTool(
      "ver_rascunho",
      {
        title: "Ver rascunho",
        description: "Um rascunho que você compôs, inteiro, com a versão atual e o que falta para a revisão.",
        inputSchema: z.object({ id: z.uuid() }),
        annotations: { readOnlyHint: true },
      },
      ({ id }) =>
        run("ver_rascunho", async () => {
          const draft = await this.draft(access, id);
          return this.describe(await this.postsQuery.detail(draft.accountId, id), draft.username);
        }),
    );

    server.registerTool(
      "listar_meus_rascunhos",
      {
        title: "Listar meus rascunhos",
        description: "Os rascunhos que você compôs para esta pessoa, com o status de cada um.",
        inputSchema: z.object({ conta: z.string().min(1).max(64).optional().describe("o @ da conta, para filtrar") }),
        annotations: { readOnlyHint: true },
      },
      ({ conta }) =>
        run("listar_meus_rascunhos", async () => {
          const accountId = conta === undefined ? null : (await this.account(conta)).id;
          const drafts = await this.postsQuery.listAssistantDrafts(access.userId, accountId);
          return {
            rascunhos: drafts.map((draft) => ({
              id: draft.id,
              conta: `@${draft.accountUsername}`,
              formato: draft.format,
              status: POST_STATUS_LABELS[draft.status],
              trecho: draft.excerpt,
              atualizadoEm: draft.updatedAt,
              link: this.link(draft.accountUsername, draft.id),
            })),
          };
        }),
    );

    server.registerTool(
      "conferir_rascunho",
      {
        title: "Conferir rascunho",
        description: "O que ainda impede um rascunho de ir para a revisão, item por item.",
        inputSchema: z.object({ id: z.uuid() }),
        annotations: { readOnlyHint: true },
      },
      ({ id }) =>
        run("conferir_rascunho", async () => {
          const draft = await this.draft(access, id);
          const post = await this.postsQuery.detail(draft.accountId, id);
          const pendencias = this.pending(post);
          return {
            pronto: pendencias.length === 0,
            pendencias,
            link: this.link(draft.username, id),
          };
        }),
    );

    return server;
  }

  /**
   * A imagem nova do assistente (ADR 0029, decisão 5): a API baixa com a busca segura
   * e ela entra pelo mesmo ingresso do envio da tela — `recebidos/`, conferência,
   * `publicas/`.
   *
   * Uma linha de log por chamada, para o M-3 (docs/16): de onde veio e como terminou,
   * **nunca a URL** — a de download do ChatGPT carrega credencial (regra 3).
   */
  private async uploadImage(input: {
    arquivo?: { download_url: string; file_id: string } | undefined;
    url?: string | undefined;
  }): Promise<unknown> {
    const origem = input.arquivo !== undefined ? "anexo" : "url";
    if ((input.arquivo === undefined) === (input.url === undefined)) {
      throw new ToolRefusal("Informe a imagem de um jeito só: anexada na conversa, ou por uma URL https.");
    }
    const endereco = input.arquivo?.download_url ?? input.url ?? "";
    if (endereco.trim() === "") {
      this.logger.warn(`enviar_imagem: ${origem} sem endereço — o arquivo não chegou`);
      throw new ToolRefusal("O arquivo não chegou até o PostIt. Anexe a imagem de novo na conversa.");
    }

    let bytes: Buffer;
    try {
      bytes = await this.downloader.download(endereco);
    } catch (error) {
      const motivo = error instanceof SafeFetchError ? error.message : "falha";
      this.logger.warn(`enviar_imagem: ${origem} não baixou (${motivo})`);
      if (motivo === "maior que o limite") throw new ToolRefusal(AUTH_ERROR_MESSAGES.MEDIA_TOO_LARGE);
      throw new ToolRefusal(
        "Não consegui baixar a imagem. Anexe de novo na conversa, ou envie pela tela do PostIt.",
      );
    }

    try {
      const imagem = await this.mediaDomain.ingestBytes(bytes);
      this.logger.log(`enviar_imagem: ${origem} aceita (${bytes.length} bytes)`);
      return {
        id: imagem.id,
        largura: imagem.width,
        altura: imagem.height,
        serveA: formatsFor(imagem.width, imagem.height),
        previa: imagem.url,
      };
    } catch (error) {
      if (error instanceof AppError) {
        this.logger.warn(`enviar_imagem: ${origem} recusada (${error.code})`);
        if (error.code === "MEDIA_WRONG_TYPE") {
          throw new ToolRefusal(
            "Só JPEG. PNG, WebP e HEIC precisam ser convertidos antes — ou enviados pela tela do PostIt, que converte sozinha.",
          );
        }
      }
      throw error;
    }
  }

  private async createDraft(
    access: AssistantAccess,
    input: {
      conta: string;
      formato: ComposableFormat;
      legenda?: string | undefined;
      imagens?: { id: string; textoAlternativo?: string | undefined }[] | undefined;
    },
  ): Promise<unknown> {
    const account = await this.account(input.conta);
    const imagens = input.imagens ?? [];

    // Tudo o que pode dar errado é conferido **antes** de criar: uma recusa no meio
    // deixaria para trás um rascunho vazio, que ninguém pediu.
    const quantidade = imagens.length === 0 ? null : postMediaCountProblem(input.formato, imagens.length);
    if (quantidade !== null) throw new ToolRefusal(AUTH_ERROR_MESSAGES[quantidade]);
    const existentes = await this.media.existing(imagens.map((imagem) => imagem.id));
    const faltando = imagens.findIndex((imagem) => !existentes.has(imagem.id));
    if (faltando !== -1) {
      throw new ToolRefusal(`A imagem ${faltando + 1} não está no acervo. Use os ids de listar_acervo.`);
    }

    const { id } = await this.posts.create({
      accountId: account.id,
      userId: access.userId,
      format: input.formato,
      caption: emptyToNull(input.legenda),
      origin: "ASSISTANT",
    });
    if (imagens.length > 0) {
      await this.posts.setMedia({
        accountId: account.id,
        postId: id,
        version: 1,
        userId: access.userId,
        media: imagens.map(toMedia),
      });
    }

    return this.describe(await this.postsQuery.detail(account.id, id), account.username);
  }

  /**
   * Cada campo informado é uma escrita, encadeando a versão. Formato e imagens
   * dependem um do outro — Stories aceita uma imagem só —, então vai primeiro o que
   * deixa o estado intermediário válido.
   */
  private async editDraft(
    access: AssistantAccess,
    input: {
      id: string;
      versao: number;
      legenda?: string | null | undefined;
      formato?: ComposableFormat | undefined;
      imagens?: { id: string; textoAlternativo?: string | undefined }[] | undefined;
    },
  ): Promise<unknown> {
    const draft = await this.draft(access, input.id);
    // Passado do rascunho, a postagem está com a pessoa: editar a derrubaria de volta
    // (I-2) e desfaria a decisão dela.
    if (draft.status !== "DRAFT") {
      throw new ToolRefusal(
        `Este rascunho já está ${POST_STATUS_LABELS[draft.status].toLowerCase()} e só pode ser mudado por uma pessoa, na tela.`,
      );
    }

    if (input.imagens !== undefined) {
      const existentes = await this.media.existing(input.imagens.map((imagem) => imagem.id));
      const faltando = input.imagens.findIndex((imagem) => !existentes.has(imagem.id));
      if (faltando !== -1) {
        throw new ToolRefusal(`A imagem ${faltando + 1} não está no acervo. Use os ids de listar_acervo.`);
      }
    }

    const scope = { accountId: draft.accountId, postId: input.id, userId: access.userId };
    let version = input.versao;

    const setFormat = async (format: ComposableFormat) => {
      version = (await this.posts.setFormat({ ...scope, version, format })).version;
    };
    const setMedia = async (imagens: { id: string; textoAlternativo?: string | undefined }[]) => {
      version = (await this.posts.setMedia({ ...scope, version, media: imagens.map(toMedia) })).version;
    };

    if (input.formato !== undefined && input.imagens !== undefined) {
      const atual = await this.postsQuery.detail(draft.accountId, input.id);
      // Cabem as imagens de agora no formato novo? Então o formato vai primeiro.
      if (postMediaCountProblem(input.formato, atual.media.length) === null) {
        await setFormat(input.formato);
        await setMedia(input.imagens);
      } else {
        await setMedia(input.imagens);
        await setFormat(input.formato);
      }
    } else if (input.formato !== undefined) {
      await setFormat(input.formato);
    } else if (input.imagens !== undefined) {
      await setMedia(input.imagens);
    }

    if (input.legenda !== undefined) {
      version = (await this.posts.setCaption({ ...scope, version, caption: emptyToNull(input.legenda) })).version;
    }

    return this.describe(await this.postsQuery.detail(draft.accountId, input.id), draft.username);
  }

  /** O rascunho que o assistente desta pessoa alcança; qualquer outro é "não encontrado". */
  private async draft(access: AssistantAccess, id: string) {
    const draft = await this.postsQuery.findAssistantDraft(access.userId, id);
    if (draft === null) throw new ToolRefusal(NOT_FOUND);
    return draft;
  }

  private async account(input: string) {
    const username = input.trim().replace(/^@/, "").toLowerCase();
    const account = (await this.accounts.list(new Date())).find((item) => item.username.toLowerCase() === username);
    if (account === undefined) {
      throw new ToolRefusal(`A conta @${username} não está conectada ao PostIt. Veja as contas com listar_contas.`);
    }
    return account;
  }

  private describe(post: PostDetail, username: string) {
    return {
      id: post.id,
      conta: `@${username}`,
      formato: post.format,
      status: POST_STATUS_LABELS[post.status],
      versao: post.version,
      legenda: post.caption,
      imagens: post.media.map((item) => ({
        id: item.mediaId,
        textoAlternativo: item.altText,
        largura: item.width,
        altura: item.height,
      })),
      pendencias: this.pending(post),
      link: this.link(username, post.id),
    };
  }

  /** O que impede a revisão, em frases para a pessoa, com a foto de cada item. */
  private pending(post: PostDetail): string[] {
    if (!isImageFormat(post.format)) return [];
    const format = post.format;
    const problemas = postProblems({
      format,
      caption: post.caption,
      // Os fatos vêm do detalhe; o tipo e o tamanho já foram conferidos no envio ao acervo.
      media: post.media.map((item) => ({ mimeType: "image/jpeg", bytes: 0, width: item.width, height: item.height })),
    });

    const frases = problemas.map(({ problem, imageIndex }) => {
      if (problem === "MEDIA_RATIO_UNSUPPORTED" && imageIndex !== null) {
        const spec = IMAGE_SPECS[format];
        return `A foto ${imageIndex + 1} não serve ao ${POST_FORMAT_LABELS[format]} (${spec.ratioLabel ?? ""}): precisa de ajuste na tela, feito por uma pessoa.`;
      }
      const frase = AUTH_ERROR_MESSAGES[problem];
      return imageIndex === null ? frase : `Foto ${imageIndex + 1}: ${frase}`;
    });

    const semTexto = post.media.flatMap((item, indice) => (item.altText === null ? [indice + 1] : []));
    if (semTexto.length > 0) {
      frases.push(`Sem texto alternativo: foto ${semTexto.join(", ")}. Não impede a revisão, mas faz falta.`);
    }
    return frases;
  }

  private link(username: string, postId: string): string {
    return `${this.config.issuer}/c/${username}/postagens/${postId}`;
  }

  /**
   * Toda ferramenta passa por aqui. Recusa e erro da API viram **resultado** com a
   * frase em português, que o assistente repassa à pessoa — não erro de protocolo.
   * O resto vira frase genérica; no log vai só o nome da ferramenta e o tipo do
   * erro, nunca a legenda nem o que o assistente mandou (regra 3).
   */
  private async run(name: string, fn: () => Promise<unknown>): Promise<CallToolResult> {
    try {
      return { content: [{ type: "text", text: JSON.stringify(await fn()) }] };
    } catch (error) {
      if (error instanceof ToolRefusal) return refusal(error.message);
      if (error instanceof AppError) {
        if (error.code === "POST_NOT_FOUND") return refusal(NOT_FOUND);
        if (error.code === "POST_VERSION_CONFLICT") {
          return refusal(
            "O rascunho mudou desde a sua última leitura — alguém o editou na tela. Leia de novo com ver_rascunho e refaça a mudança sobre a versão nova.",
          );
        }
        return refusal(error.message);
      }
      this.logger.error(`${name} falhou: ${error instanceof Error ? error.name : "erro"}`);
      return refusal("O PostIt não conseguiu concluir agora. Tente de novo em instantes.");
    }
  }
}

function refusal(text: string): CallToolResult {
  return { content: [{ type: "text", text }], isError: true };
}

function emptyToNull(caption: string | null | undefined): string | null {
  return caption === undefined || caption === null || caption.trim() === "" ? null : caption;
}

function toMedia(imagem: { id: string; textoAlternativo?: string | undefined }) {
  const altText = imagem.textoAlternativo?.trim();
  return { mediaId: imagem.id, altText: altText === undefined || altText === "" ? null : altText };
}
