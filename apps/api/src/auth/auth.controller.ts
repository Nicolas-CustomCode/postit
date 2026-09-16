import { Body, Controller, Get, HttpCode, Post } from "@nestjs/common";
import {
  challengeCompleteSchema,
  challengeSetupSchema,
  changePasswordSchema,
  confirmCodeSchema,
  consumeLinkSchema,
  inspectLinkSchema,
  loginSchema,
  passwordProblem,
  type AccessLinkInfo,
  type ActiveSession,
  type ChallengeStarted,
  type SessionInfo,
  type SessionIssued,
  type TwoFactorSetup,
} from "@repo/shared";
import { PasswordPolicyError } from "../common/errors";
import type { ClientContext } from "../common/request-context";
import { ZodValidationPipe } from "../common/zod-validation.pipe";
import { AnyAuthenticated, Public } from "../authorization/policy.decorators";
import { Auth, Client } from "./auth.decorators";
import { AuthService } from "./auth.service";
import { LinksService } from "./links.service";
import type { AuthContext } from "./session.service";
import { SessionService } from "./session.service";
import { UsersService } from "../users/users.service";

/**
 * As rotas de autenticação.
 *
 * A API **não toca em cookie**: devolve token e expiração no corpo, e quem grava
 * é o Next. Toda rota declara sua política — rota sem declaração é recusada pelo
 * guard e reprova o teste de política de rotas.
 */
@Controller("auth")
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly sessions: SessionService,
    private readonly links: LinksService,
    private readonly users: UsersService,
  ) {}

  @Public()
  @Post("login")
  @HttpCode(200)
  login(
    @Body(new ZodValidationPipe(loginSchema)) body: { email: string; password: string },
    @Client() client: ClientContext,
  ): Promise<ChallengeStarted> {
    return this.auth.login({ ...body, client, now: new Date() });
  }

  /** Primeiro acesso: o QR para cadastrar o aplicativo autenticador. */
  @Public()
  @Post("challenge/totp-setup")
  @HttpCode(200)
  totpSetup(@Body(new ZodValidationPipe(challengeSetupSchema)) body: { token: string }): Promise<TwoFactorSetup> {
    return this.auth.startTotpSetup(body.token, new Date());
  }

  @Public()
  @Post("challenge/verify")
  @HttpCode(200)
  verify(
    @Body(new ZodValidationPipe(challengeCompleteSchema)) body: { token: string; code: string },
    @Client() client: ClientContext,
  ): Promise<SessionIssued> {
    return this.auth.completeChallenge({ ...body, client, now: new Date() });
  }

  /** É o que o requireSession() do Next consulta a cada requisição. */
  @AnyAuthenticated()
  @Get("session")
  session(@Auth() auth: AuthContext): SessionInfo {
    return {
      user: {
        id: auth.userId,
        name: auth.name,
        email: auth.email,
        superAdmin: auth.superAdmin,
        permissions: auth.permissions,
      },
      session: {
        createdAt: auth.createdAt.toISOString(),
        expiresAt: auth.expiresAt.toISOString(),
        verifiedAt: auth.verifiedAt.toISOString(),
        recentlyConfirmed: auth.recentlyConfirmed,
      },
    };
  }

  @AnyAuthenticated()
  @Post("logout")
  @HttpCode(204)
  async logout(@Auth() auth: AuthContext): Promise<void> {
    await this.sessions.revoke(auth.sessionId, "LOGGED_OUT", new Date());
  }

  /** Confirmação recente, para liberar ação administrativa (RF-I08). */
  @AnyAuthenticated()
  @Post("confirm")
  @HttpCode(200)
  async confirm(
    @Auth() auth: AuthContext,
    @Body(new ZodValidationPipe(confirmCodeSchema)) body: { code: string },
  ): Promise<{ verifiedAt: string }> {
    const verifiedAt = await this.auth.confirm(auth, body.code, new Date());
    return { verifiedAt: verifiedAt.toISOString() };
  }

  @AnyAuthenticated()
  @Get("sessions")
  sessionsList(@Auth() auth: AuthContext): Promise<ActiveSession[]> {
    return this.sessions.listActive(auth.userId, auth.sessionId, new Date());
  }

  /** "Sair dos outros dispositivos" — a sessão atual continua. */
  @AnyAuthenticated()
  @Post("sessions/revoke-others")
  @HttpCode(200)
  async revokeOthers(@Auth() auth: AuthContext): Promise<{ revoked: number }> {
    const revoked = await this.sessions.revokeAllForUser(auth.userId, "ENDED_BY_USER", new Date(), auth.sessionId);
    return { revoked };
  }

  @AnyAuthenticated()
  @Post("password")
  @HttpCode(200)
  async changePassword(
    @Auth() auth: AuthContext,
    @Body(new ZodValidationPipe(changePasswordSchema))
    body: { currentPassword: string; newPassword: string; code: string },
  ): Promise<{ revoked: number }> {
    const revoked = await this.auth.changePassword(auth, body, new Date());
    return { revoked };
  }

  @AnyAuthenticated()
  @Post("recovery-codes")
  @HttpCode(200)
  async recoveryCodes(
    @Auth() auth: AuthContext,
    @Body(new ZodValidationPipe(confirmCodeSchema)) body: { code: string },
  ): Promise<{ codes: string[] }> {
    return { codes: await this.auth.regenerateRecoveryCodes(auth, body.code, new Date()) };
  }

  /** A tela do link mostra de quem ele é antes de pedir a senha. */
  @Public()
  @Post("links/inspect")
  @HttpCode(200)
  inspectLink(
    @Body(new ZodValidationPipe(inspectLinkSchema)) body: { token: string; purpose: "SIGNUP" | "PASSWORD_RESET" },
  ): Promise<AccessLinkInfo> {
    return this.links.inspect(body.token, body.purpose, new Date());
  }

  /**
   * Define a senha pelo link e **não** cria sessão: a pessoa vai para /entrar e
   * passa pelas duas etapas. Um caminho que criasse sessão aqui seria um login
   * que fura a verificação em duas etapas.
   */
  @Public()
  @Post("links/consume")
  @HttpCode(204)
  async consumeLink(
    @Body(new ZodValidationPipe(consumeLinkSchema))
    body: { token: string; purpose: "SIGNUP" | "PASSWORD_RESET"; password: string },
  ): Promise<void> {
    const now = new Date();

    // A política da senha é conferida ANTES de o link ser marcado como usado:
    // do contrário, digitar uma senha curta queimaria o link e a pessoa
    // precisaria pedir outro. Conferir aqui não revela nada sobre o link — ele
    // já foi validado pelo inspect logo acima.
    const info = await this.links.inspect(body.token, body.purpose, now);
    const problem = passwordProblem(body.password, info.email);
    if (problem !== null) throw new PasswordPolicyError(problem);

    const link = await this.links.consume(body.token, body.purpose, now);
    await this.users.setPassword(link.userId, link.email, body.password);

    // Redefinição derruba todas as sessões: se a senha vazou, quem entrou com
    // ela sai. Cadastro não tem sessão nenhuma para derrubar.
    if (body.purpose === "PASSWORD_RESET") {
      await this.sessions.revokeAllForUser(link.userId, "PASSWORD_RESET", now);
    }
  }
}
