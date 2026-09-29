import { Injectable } from "@nestjs/common";
import { McpServer, type CallToolResult } from "@modelcontextprotocol/server";
import {
  CAPTION_MAX_HASHTAGS,
  CAPTION_MAX_LENGTH,
  CAPTION_MAX_MENTIONS,
  IMAGE_FORMATS,
  IMAGE_SPECS,
  POST_MEDIA_COUNT,
  VERSION,
} from "@repo/shared";
import { z } from "zod";
import { AccountsQueryService } from "../accounts/accounts.query.service";
import type { AssistantAccess } from "../oauth/oauth.service";

/**
 * O que o assistente lê antes de chamar qualquer ferramenta. Nome PostIt, nunca
 * "Insta", "gram" ou "IG" (ADR 0016).
 */
const INSTRUCTIONS = [
  "PostIt é o agendador de postagens da equipe. Por aqui você só compõe rascunhos:",
  "quem envia para revisão, aprova e agenda é uma pessoa, pela tela do PostIt.",
  "Antes de compor, consulte ver_regras — os limites são os que a tela confere.",
].join(" ");

/**
 * As ferramentas do assistente (docs/16). Uma instância de servidor por chamada,
 * presa a quem é dono do token: nenhuma ferramenta recebe o usuário como
 * parâmetro, então o assistente não tem como agir em nome de outra pessoa.
 *
 * Toda escrita passa pelos serviços de domínio, com as mesmas regras da tela —
 * nunca pelo Prisma direto.
 */
@Injectable()
export class McpToolsService {
  constructor(private readonly accounts: AccountsQueryService) {}

  createServer(access: AssistantAccess): McpServer {
    void access;
    const server = new McpServer({ name: "PostIt", version: VERSION }, { instructions: INSTRUCTIONS });

    server.registerTool(
      "listar_contas",
      {
        title: "Listar contas",
        description: "As contas conectadas ao PostIt, com o @ de cada uma e o fuso horário.",
        annotations: { readOnlyHint: true },
      },
      async () => {
        const accounts = await this.accounts.list(new Date());
        return json({
          contas: accounts.map((account) => ({
            usuario: `@${account.username}`,
            nome: account.name,
            fuso: account.timezone,
          })),
        });
      },
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
      ({ formato }) => {
        const formats = formato === undefined ? IMAGE_FORMATS : [formato];
        return json({
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
          ],
        });
      },
    );

    return server;
  }
}

function json(data: unknown): CallToolResult {
  return { content: [{ type: "text", text: JSON.stringify(data) }] };
}
