import { Inject, Injectable, Logger } from "@nestjs/common";
import type { OAuthClient, OAuthRevocationReason, Prisma } from "@repo/database";
import {
  can,
  OAUTH_SCOPE,
  type OAuthApproval,
  type OAuthAuthorizeInput,
  type OAuthRequestDescription,
  type Permission,
} from "@repo/shared";
import { AuditService } from "../audit/audit.service";
import { randomToken, sha256Hex } from "../common/crypto";
import { ValidationFailedError } from "../common/errors";
import { sessionExpiry, sessionState, shouldTouch, TOUCH_INTERVAL_MS } from "../domain/auth/session-validity";
import { decideAuthorize, sameResource, type AuthorizeDecision } from "../domain/oauth/authorize-request";
import {
  isClientMetadataUrl,
  isClientProblem,
  parseClientMetadataDocument,
  parseRegistrationRequest,
} from "../domain/oauth/client";
import { accessTokenExpiry, ACCESS_TOKEN_TTL_MS, CODE_TTL_MS, refreshTokenState } from "../domain/oauth/lifetimes";
import { pkceMatches } from "../domain/oauth/pkce";
import { PrismaService } from "../prisma/prisma.service";
import { ClientMetadataFetcher } from "./client-metadata.fetcher";
import { OAUTH_CONFIG, type OAuthConfig } from "./oauth.config";
import { OAuthError } from "./oauth-error";

/** Quem está do outro lado de um token de acesso, com as permissões de agora. */
export interface AssistantAccess {
  readonly grantId: string;
  readonly clientId: string;
  readonly userId: string;
  readonly superAdmin: boolean;
  readonly permissions: readonly Permission[];
}

/** Resposta de `/oauth/token` (RFC 6749, seção 5.1). */
export interface TokenResponse {
  readonly access_token: string;
  readonly token_type: "Bearer";
  readonly expires_in: number;
  readonly refresh_token: string;
  readonly scope: string;
}

/** Resposta de `/oauth/register` (RFC 7591, seção 3.2.1). */
export interface RegistrationResponse {
  readonly client_id: string;
  readonly client_id_issued_at: number;
  readonly client_name: string;
  readonly redirect_uris: string[];
  readonly token_endpoint_auth_method: "none";
  readonly grant_types: string[];
  readonly response_types: string[];
}

/** A ficha do CIMD é relida depois disto — o cliente pode ter trocado os endereços. */
const CIMD_CACHE_MS = 60 * 60 * 1000;

type Tx = Prisma.TransactionClient;

/**
 * O servidor OAuth mínimo do assistente (ADR 0029, decisão 4; docs/16).
 *
 * Código e tokens só existem em claro na resposta que os entrega: o banco guarda o
 * sha256, como a sessão. Toda recusa da troca é `invalid_grant`, sem dizer qual
 * conferência falhou — distinguir diria a quem testa um código roubado o que
 * ele acertou.
 */
@Injectable()
export class OAuthService {
  private readonly logger = new Logger("OAuth");

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly fetcher: ClientMetadataFetcher,
    @Inject(OAUTH_CONFIG) private readonly config: OAuthConfig,
  ) {}

  /** A tela de permissão: confere o pedido e diz o que mostrar. */
  async describe(
    input: OAuthAuthorizeInput,
    holder: { superAdmin: boolean; permissions: readonly Permission[] },
    now: Date,
  ): Promise<OAuthRequestDescription> {
    const client = await this.resolveClient(input.client_id, now);
    if (client === null) {
      return { kind: "INVALID", reason: "O aplicativo que pediu o acesso não foi reconhecido." };
    }

    const decision = this.decide(input, client);
    if (decision.kind === "FATAL") {
      return { kind: "INVALID", reason: "O endereço de retorno não pertence a este aplicativo." };
    }
    if (decision.kind === "REDIRECT") {
      return { kind: "REDIRECT", redirectTo: this.errorRedirect(decision, input.state) };
    }

    return {
      kind: "READY",
      clientName: client.name,
      redirectHost: new URL(decision.redirectUri).host,
      canAuthorize: can(holder, "POST_EDIT"),
      denyRedirect: this.redirect(decision.redirectUri, { error: "access_denied", state: input.state }),
    };
  }

  /**
   * "Permitir": cria a autorização e o código de um minuto.
   *
   * Autorizar de novo o mesmo aplicativo substitui a autorização anterior, em vez
   * de acumular: o Perfil mostra uma linha por aplicativo, e a velha para de valer.
   */
  async approve(input: OAuthAuthorizeInput, userId: string, ip: string | null, now: Date): Promise<OAuthApproval> {
    const client = await this.resolveClient(input.client_id, now);
    if (client === null) throw new ValidationFailedError(["client_id"]);
    const decision = this.decide(input, client);
    if (decision.kind === "FATAL") throw new ValidationFailedError(["redirect_uri"]);
    if (decision.kind === "REDIRECT") return { redirectTo: this.errorRedirect(decision, input.state) };

    const code = randomToken();
    const grantId = await this.prisma.db.$transaction(async (tx) => {
      const previous = await tx.oAuthGrant.findMany({
        where: { userId, clientId: client.id, revokedAt: null },
        select: { id: true },
      });
      for (const grant of previous) await this.revokeInTx(tx, grant.id, "BY_USER", now);

      const grant = await tx.oAuthGrant.create({
        data: {
          userId,
          clientId: client.id,
          scope: OAUTH_SCOPE,
          expiresAt: sessionExpiry(now, this.config.maxDays),
          lastUsedAt: now,
        },
      });
      await tx.oAuthCode.create({
        data: {
          grantId: grant.id,
          codeHash: sha256Hex(code),
          codeChallenge: decision.codeChallenge,
          redirectUri: decision.redirectUri,
          resource: decision.resource,
          expiresAt: new Date(now.getTime() + CODE_TTL_MS),
        },
      });
      return grant.id;
    });

    await this.audit.record({
      authorId: userId,
      origin: "WEB",
      action: "ASSISTANT_AUTHORIZED",
      targetType: "AutorizacaoOAuth",
      targetId: grantId,
      details: { cliente: client.name },
      ip,
    });

    return { redirectTo: this.redirect(decision.redirectUri, { code, state: input.state }) };
  }

  /** `grant_type=authorization_code`, com PKCE. O código vale uma vez. */
  async exchangeCode(body: Record<string, unknown>, now: Date): Promise<TokenResponse> {
    const code = field(body, "code");
    const verifier = field(body, "code_verifier");
    const clientId = field(body, "client_id");
    if (code === null || verifier === null || clientId === null) {
      throw new OAuthError("invalid_request", "code, code_verifier e client_id são obrigatórios");
    }

    const row = await this.prisma.db.oAuthCode.findUnique({
      where: { codeHash: sha256Hex(code) },
      include: { grant: { include: { client: true, user: true } } },
    });
    const redirectUri = field(body, "redirect_uri");
    const resource = field(body, "resource");
    if (
      row === null ||
      row.usedAt !== null ||
      row.expiresAt.getTime() <= now.getTime() ||
      row.grant.client.clientId !== clientId ||
      (redirectUri !== null && redirectUri !== row.redirectUri) ||
      !pkceMatches(verifier, row.codeChallenge) ||
      !this.grantUsable(row.grant, now)
    ) {
      throw new OAuthError("invalid_grant", "código inválido, vencido ou já usado");
    }
    if (resource !== null && !sameResource(resource, row.resource)) {
      throw new OAuthError("invalid_target", "este servidor só emite tokens para o próprio /mcp");
    }

    return this.prisma.db.$transaction(async (tx) => {
      // A marca de uso e a condição no mesmo UPDATE: duas trocas simultâneas do
      // mesmo código, e só uma leva os tokens.
      const used = await tx.oAuthCode.updateMany({ where: { id: row.id, usedAt: null }, data: { usedAt: now } });
      if (used.count === 0) throw new OAuthError("invalid_grant", "código inválido, vencido ou já usado");
      return this.issueTokens(tx, row.grant, now);
    });
  }

  /**
   * `grant_type=refresh_token`, com rotação: cada renovação sai trocada por outra.
   * A mesma aparecer duas vezes derruba a autorização inteira (OAuth 2.1, 4.3.1).
   */
  async refresh(body: Record<string, unknown>, now: Date): Promise<TokenResponse> {
    const token = field(body, "refresh_token");
    const clientId = field(body, "client_id");
    if (token === null || clientId === null) {
      throw new OAuthError("invalid_request", "refresh_token e client_id são obrigatórios");
    }

    const row = await this.prisma.db.oAuthToken.findUnique({
      where: { tokenHash: sha256Hex(token) },
      include: { grant: { include: { client: true, user: true } } },
    });
    if (row === null || row.kind !== "REFRESH" || row.grant.client.clientId !== clientId) {
      throw new OAuthError("invalid_grant", "renovação inválida");
    }

    const state = refreshTokenState(row, now);
    if (state === "REUSED") {
      await this.revokeReused(row.grantId, now);
      throw new OAuthError("invalid_grant", "renovação inválida");
    }
    if (state !== "USABLE" || !this.grantUsable(row.grant, now)) {
      throw new OAuthError("invalid_grant", "renovação inválida");
    }

    const issued = await this.prisma.db.$transaction(async (tx) => {
      const used = await tx.oAuthToken.updateMany({ where: { id: row.id, usedAt: null }, data: { usedAt: now } });
      if (used.count === 0) return null;
      return this.issueTokens(tx, row.grant, now);
    });
    if (issued === null) {
      // Outra renovação com o mesmo valor ganhou a corrida: também é reuso.
      await this.revokeReused(row.grantId, now);
      throw new OAuthError("invalid_grant", "renovação inválida");
    }
    return issued;
  }

  /** Registro dinâmico (RFC 7591): só cliente público, e o `client_id` sorteado aqui. */
  async register(body: unknown, now: Date): Promise<RegistrationResponse> {
    const metadata = parseRegistrationRequest(body);
    if (isClientProblem(metadata)) throw new OAuthError("invalid_client_metadata", metadata.problem);

    const client = await this.prisma.db.oAuthClient.create({
      data: { clientId: randomToken(), source: "REGISTERED", name: metadata.name, redirectUris: metadata.redirectUris },
    });
    this.logger.log(`Cliente registrado: ${client.name}`);

    return {
      client_id: client.clientId,
      client_id_issued_at: Math.floor(now.getTime() / 1000),
      client_name: client.name,
      redirect_uris: client.redirectUris,
      token_endpoint_auth_method: "none",
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
    };
  }

  /**
   * O token de acesso de uma chamada ao `/mcp`. `null` por qualquer motivo —
   * vencido, revogado, autorização parada, pessoa desativada: para o cliente é o
   * mesmo 401, e ele renova ou pede de novo.
   */
  async resolveAccess(token: string, now: Date): Promise<AssistantAccess | null> {
    const row = await this.prisma.db.oAuthToken.findUnique({
      where: { tokenHash: sha256Hex(token) },
      include: {
        grant: { include: { client: true, user: { include: { permissions: { select: { permission: true } } } } } },
      },
    });
    if (row === null || row.kind !== "ACCESS" || row.revokedAt !== null) return null;
    if (row.expiresAt.getTime() <= now.getTime()) return null;
    if (!this.grantUsable(row.grant, now)) return null;

    if (shouldTouch(row.grant.lastUsedAt, now)) {
      await this.prisma.db.oAuthGrant.updateMany({
        where: { id: row.grantId, lastUsedAt: { lte: new Date(now.getTime() - TOUCH_INTERVAL_MS) } },
        data: { lastUsedAt: now },
      });
    }

    return {
      grantId: row.grantId,
      clientId: row.grant.client.clientId,
      userId: row.grant.userId,
      superAdmin: row.grant.user.superAdmin,
      permissions: row.grant.user.permissions.map((p) => p.permission),
    };
  }

  /** Cliente pelo `client_id`: ficha do CIMD (com cache curto) ou registrado aqui. */
  private async resolveClient(clientId: string, now: Date): Promise<OAuthClient | null> {
    const stored = await this.prisma.db.oAuthClient.findUnique({ where: { clientId } });
    if (!isClientMetadataUrl(clientId)) return stored?.source === "REGISTERED" ? stored : null;

    if (stored?.fetchedAt != null && now.getTime() - stored.fetchedAt.getTime() < CIMD_CACHE_MS) return stored;

    let document: unknown;
    try {
      document = await this.fetcher.fetch(clientId);
    } catch (error) {
      this.logger.warn(`Ficha do cliente ilegível: ${error instanceof Error ? error.message : "falha"}`);
      return null;
    }
    const metadata = parseClientMetadataDocument(clientId, document);
    if (isClientProblem(metadata)) {
      this.logger.warn(`Ficha do cliente recusada: ${metadata.problem}`);
      return null;
    }

    const data = { name: metadata.name, redirectUris: metadata.redirectUris, fetchedAt: now };
    return this.prisma.db.oAuthClient.upsert({
      where: { clientId },
      create: { clientId, source: "CIMD", ...data },
      update: data,
    });
  }

  private decide(input: OAuthAuthorizeInput, client: OAuthClient): AuthorizeDecision {
    return decideAuthorize(
      {
        responseType: input.response_type,
        redirectUri: input.redirect_uri,
        codeChallenge: input.code_challenge,
        codeChallengeMethod: input.code_challenge_method,
        scope: input.scope,
        resource: input.resource,
      },
      client.redirectUris,
      this.config.resource,
    );
  }

  private grantUsable(
    grant: { expiresAt: Date; lastUsedAt: Date; revokedAt: Date | null; user: { deactivatedAt: Date | null } },
    now: Date,
  ): boolean {
    return sessionState(grant, now, this.config.idleDays) === "ACTIVE" && grant.user.deactivatedAt === null;
  }

  private async issueTokens(tx: Tx, grant: { id: string; expiresAt: Date }, now: Date): Promise<TokenResponse> {
    const access = randomToken();
    const refresh = randomToken();
    const accessExpiresAt = accessTokenExpiry(now, grant.expiresAt);

    await tx.oAuthToken.createMany({
      data: [
        { grantId: grant.id, tokenHash: sha256Hex(access), kind: "ACCESS", expiresAt: accessExpiresAt },
        // A renovação vale até o teto da autorização, e nunca além.
        { grantId: grant.id, tokenHash: sha256Hex(refresh), kind: "REFRESH", expiresAt: grant.expiresAt },
      ],
    });
    await tx.oAuthGrant.update({ where: { id: grant.id }, data: { lastUsedAt: now } });

    return {
      access_token: access,
      token_type: "Bearer",
      expires_in: Math.min(ACCESS_TOKEN_TTL_MS, accessExpiresAt.getTime() - now.getTime()) / 1000,
      refresh_token: refresh,
      scope: OAUTH_SCOPE,
    };
  }

  private async revokeReused(grantId: string, now: Date): Promise<void> {
    const revoked = await this.prisma.db.$transaction((tx) => this.revokeInTx(tx, grantId, "REFRESH_REUSED", now));
    if (!revoked) return;
    this.logger.warn(`Renovação reusada — autorização ${grantId} revogada`);
    await this.audit.record({
      authorId: null,
      origin: "WEB",
      action: "ASSISTANT_REVOKED",
      targetType: "AutorizacaoOAuth",
      targetId: grantId,
      details: { motivo: "RENOVACAO_REUSADA" },
    });
  }

  /** Revoga a autorização e tudo o que ela emitiu. `false` se já estava revogada. */
  private async revokeInTx(tx: Tx, grantId: string, reason: OAuthRevocationReason, now: Date): Promise<boolean> {
    const grant = await tx.oAuthGrant.updateMany({
      where: { id: grantId, revokedAt: null },
      data: { revokedAt: now, revocationReason: reason },
    });
    await tx.oAuthToken.updateMany({ where: { grantId, revokedAt: null }, data: { revokedAt: now } });
    await tx.oAuthCode.updateMany({ where: { grantId, usedAt: null }, data: { usedAt: now } });
    return grant.count > 0;
  }

  private errorRedirect(decision: Extract<AuthorizeDecision, { kind: "REDIRECT" }>, state: string | undefined): string {
    return this.redirect(decision.redirectUri, {
      error: decision.error,
      error_description: decision.description,
      state,
    });
  }

  /** O retorno ao cliente, com `iss` (RFC 9207) contra a confusão entre servidores. */
  private redirect(redirectUri: string, params: Record<string, string | undefined>): string {
    const url = new URL(redirectUri);
    for (const [key, value] of Object.entries(params)) {
      if (value !== undefined) url.searchParams.set(key, value);
    }
    url.searchParams.set("iss", this.config.issuer);
    return url.toString();
  }
}

/** Um campo de texto do corpo do `/oauth/token`, que chega como formulário. */
function field(body: Record<string, unknown>, name: string): string | null {
  const value = body[name];
  return typeof value === "string" && value.length > 0 && value.length <= 4096 ? value : null;
}
