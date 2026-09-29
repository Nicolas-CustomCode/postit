import { Body, Controller, Get, Header, HttpCode, Post, Query, Req, UseFilters } from "@nestjs/common";
import {
  oauthAuthorizeSchema,
  type OAuthApproval,
  type OAuthAuthorizeInput,
  type OAuthRequestDescription,
} from "@repo/shared";
import type { FastifyRequest } from "fastify";
import { Auth } from "../auth/auth.decorators";
import type { AuthContext } from "../auth/session.service";
import { AnyAuthenticated, Public, RequirePermission } from "../authorization/policy.decorators";
import { clientIp } from "../common/request-context";
import { ZodValidationPipe } from "../common/zod-validation.pipe";
import { OAuthError, OAuthErrorFilter } from "./oauth-error";
import { OAuthService, type RegistrationResponse, type TokenResponse } from "./oauth.service";

/**
 * O servidor OAuth do assistente (ADR 0029). Dois públicos diferentes:
 *
 *  - a **tela de permissão** do Next, com a sessão da pessoa: `requests` e `approve`.
 *    Autorizar é ação — exige `POSTAGEM_EDITAR`, a mesma permissão que o assistente
 *    vai usar;
 *  - o **cliente OAuth**, sem sessão: `token` e `register`. `@Public` quer dizer sem
 *    sessão, e não sem a chave interna — quem chega aqui passou pelo Next.
 */
@Controller("oauth")
export class OAuthController {
  constructor(private readonly oauth: OAuthService) {}

  @AnyAuthenticated()
  @Get("requests")
  describe(
    @Auth() auth: AuthContext,
    @Query(new ZodValidationPipe(oauthAuthorizeSchema)) query: OAuthAuthorizeInput,
  ): Promise<OAuthRequestDescription> {
    return this.oauth.describe(query, auth, new Date());
  }

  @RequirePermission("POST_EDIT")
  @Post("approve")
  @HttpCode(200)
  approve(
    @Auth() auth: AuthContext,
    @Req() request: FastifyRequest,
    @Body(new ZodValidationPipe(oauthAuthorizeSchema)) body: OAuthAuthorizeInput,
  ): Promise<OAuthApproval> {
    return this.oauth.approve(body, auth.userId, clientIp(request), new Date());
  }

  /** RFC 6749, seção 3.2. O corpo chega como formulário, como o protocolo manda. */
  @Public()
  @Post("token")
  @HttpCode(200)
  @Header("cache-control", "no-store")
  @UseFilters(OAuthErrorFilter)
  token(@Body() body: unknown): Promise<TokenResponse> {
    const fields = typeof body === "object" && body !== null ? (body as Record<string, unknown>) : {};
    const now = new Date();
    if (fields["grant_type"] === "authorization_code") return this.oauth.exchangeCode(fields, now);
    if (fields["grant_type"] === "refresh_token") return this.oauth.refresh(fields, now);
    throw new OAuthError("unsupported_grant_type", "só authorization_code e refresh_token");
  }

  @Public()
  @Post("register")
  @HttpCode(201)
  @Header("cache-control", "no-store")
  @UseFilters(OAuthErrorFilter)
  register(@Body() body: unknown): Promise<RegistrationResponse> {
    return this.oauth.register(body, new Date());
  }
}
