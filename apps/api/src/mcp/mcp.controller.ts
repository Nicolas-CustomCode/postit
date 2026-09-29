import { Controller, Inject, Post, Req, Res, type OnModuleDestroy } from "@nestjs/common";
import { createMcpHandler, type McpHttpHandler } from "@modelcontextprotocol/server";
import { can, OAUTH_SCOPE } from "@repo/shared";
import type { FastifyReply, FastifyRequest } from "fastify";
import { Public } from "../authorization/policy.decorators";
import { bearerToken } from "../common/request-context";
import { OAuthService, type AssistantAccess } from "../oauth/oauth.service";
import { OAUTH_CONFIG, type OAuthConfig } from "../oauth/oauth.config";
import { McpRateLimiter } from "./mcp-rate-limiter";
import { McpToolsService } from "./mcp-tools.service";

/**
 * Os cabeçalhos do protocolo que atravessam, nos dois sentidos, mais todo `mcp-*` — o
 * protocolo de 2026-07-28 exige o `Mcp-Method` em toda chamada, e novos podem vir.
 * Nada de cookie nem do `Authorization`, que já foi conferido aqui.
 */
const FORWARDED_HEADERS = ["accept", "content-type", "last-event-id"];
const forwarded = (name: string) => FORWARDED_HEADERS.includes(name) || name.toLowerCase().startsWith("mcp-");

/**
 * O servidor MCP do assistente (ADR 0029, docs/16), sem estado: cada chamada é um
 * POST, e o servidor de ferramentas nasce e morre nela. O protocolo de 2026-07-28
 * responde JSON; o de 2025 responde SSE de um evento só, que termina com a
 * resposta — os dois cabem no repasse do Next, que lê o corpo inteiro.
 *
 * `@Public` porque quem se identifica aqui é o **token OAuth**, e não a sessão — o
 * `SessionGuard` não o reconhece e deixa a requisição anônima. A chave interna
 * continua obrigatória: só o Next chega aqui. O token é conferido abaixo, a cada
 * chamada, com as permissões de agora.
 */
@Controller("mcp")
export class McpController implements OnModuleDestroy {
  private readonly handler: McpHttpHandler;

  constructor(
    private readonly oauth: OAuthService,
    private readonly tools: McpToolsService,
    private readonly limiter: McpRateLimiter,
    @Inject(OAUTH_CONFIG) private readonly config: OAuthConfig,
  ) {
    this.handler = createMcpHandler((context) => {
      const access = context.authInfo?.extra?.["access"] as AssistantAccess | undefined;
      if (access === undefined) throw new Error("chamada ao MCP sem acesso resolvido");
      return this.tools.createServer(access);
    });
  }

  async onModuleDestroy(): Promise<void> {
    await this.handler.close();
  }

  @Public()
  @Post()
  async handle(@Req() request: FastifyRequest, @Res() reply: FastifyReply): Promise<void> {
    const now = new Date();
    const token = bearerToken(request);
    const access = token === null ? null : await this.oauth.resolveAccess(token, now);

    if (token === null || access === null) {
      // O cabeçalho é o que leva o cliente à descoberta do OAuth (RFC 9728, seção 5.1).
      const metadata = `${this.config.issuer}/.well-known/oauth-protected-resource`;
      const error = token === null ? "" : ', error="invalid_token"';
      await reply
        .status(401)
        .header("www-authenticate", `Bearer resource_metadata="${metadata}"${error}`)
        .send({ error: "invalid_token" });
      return;
    }

    // A permissão é a de agora: quem perdeu POSTAGEM_EDITAR perde o assistente na hora.
    if (!can(access, "POST_EDIT")) {
      await reply.status(403).send({ error: "insufficient_scope" });
      return;
    }
    if (!this.limiter.take(access.grantId, now)) {
      await reply.status(429).header("retry-after", "60").send({ error: "rate_limited" });
      return;
    }

    const headers = new Headers();
    for (const [name, value] of Object.entries(request.headers)) {
      if (forwarded(name) && typeof value === "string") headers.set(name, value);
    }
    const response = await this.handler.fetch(
      new Request(this.config.resource, { method: "POST", headers, body: JSON.stringify(request.body ?? null) }),
      {
        authInfo: { token, clientId: access.clientId, scopes: [OAUTH_SCOPE], extra: { access } },
        parsedBody: request.body,
      },
    );

    reply.status(response.status);
    response.headers.forEach((value, name) => {
      if (forwarded(name)) reply.header(name, value);
    });
    await reply.send(Buffer.from(await response.arrayBuffer()));
  }
}
