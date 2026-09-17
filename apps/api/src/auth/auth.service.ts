import { Injectable } from "@nestjs/common";
import {
  isTotpCodeShaped,
  normalizeEmail,
  type ChallengeStarted,
  type SessionIssued,
  type SessionUser,
  type TwoFactorSetup,
} from "@repo/shared";
import { AccountDeactivatedError, InvalidCodeError, InvalidCredentialsError } from "../common/errors";
import type { ClientContext } from "../common/request-context";
import { PrismaService } from "../prisma/prisma.service";
import { ChallengeService } from "./challenge.service";
import { LockoutService } from "./lockout.service";
import { verifyPassword } from "./password";
import { SessionService, type AuthContext } from "./session.service";
import { TotpService } from "./totp.service";
import { UsersService } from "../users/users.service";

/**
 * O fluxo de login inteiro, de ponta a ponta (ADR 0013, seções 2 e 5).
 *
 * ⚠️ A ordem é regra, não estilo: **bloqueio → senha → código**. Conferir o
 * bloqueio depois da senha faz acertar a senha furar um bloqueio ativo.
 */
@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly sessions: SessionService,
    private readonly challenges: ChallengeService,
    private readonly totp: TotpService,
    private readonly lockout: LockoutService,
    private readonly users: UsersService,
  ) {}

  /**
   * Senha certa **não** cria sessão: cria um desafio.
   *
   * E-mail inexistente e senha errada saem pela mesma porta, com a mesma
   * mensagem e o mesmo tempo — o tempo graças ao hash isca, dentro de
   * `verifyPassword`.
   */
  async login(input: { email: string; password: string; client: ClientContext; now: Date }): Promise<ChallengeStarted> {
    const email = normalizeEmail(input.email);
    await this.lockout.ensureNotBlocked(email, input.client.ip, input.now);

    const user = await this.prisma.db.user.findUnique({ where: { email } });
    const ok = await verifyPassword(user?.passwordHash ?? null, input.password);

    if (!ok) {
      await this.lockout.registerFailure(
        email,
        input.client.ip,
        user === null ? "UNKNOWN_EMAIL" : "WRONG_PASSWORD",
        input.now,
      );
      throw new InvalidCredentialsError();
    }

    // Só depois da senha certa é que dizemos que a conta está desativada. Antes
    // disso, a resposta genérica evita descobrir quais e-mails existem.
    if (user === null || user.deactivatedAt !== null) throw new AccountDeactivatedError();

    const purpose = user.totpEnabledAt === null ? "SETUP_2FA" : "VERIFY_2FA";
    const challenge = await this.challenges.start(user.id, purpose, input.now);

    return { token: challenge.token, expiresAt: challenge.expiresAt.toISOString(), purpose };
  }

  /** Primeiro acesso: mostra o QR para a pessoa cadastrar o aplicativo. */
  async startTotpSetup(challengeToken: string, now: Date): Promise<TwoFactorSetup> {
    const challenge = await this.challenges.load(challengeToken, now);
    return this.totp.beginSetup(challenge.user.id, challenge.user.email);
  }

  /**
   * Fecha o desafio e cria a sessão.
   *
   * Aceita código do aplicativo ou código de recuperação — a pessoa que perdeu o
   * celular precisa de um caminho de volta. Código errado gasta tentativa do
   * desafio e conta na proteção contra tentativas repetidas.
   */
  async completeChallenge(input: {
    token: string;
    code: string;
    client: ClientContext;
    now: Date;
  }): Promise<SessionIssued> {
    const challenge = await this.challenges.load(input.token, input.now);
    const email = challenge.user.email;
    await this.lockout.ensureNotBlocked(email, input.client.ip, input.now);

    const first = challenge.purpose === "SETUP_2FA";
    const accepted = isTotpCodeShaped(input.code.trim())
      ? await this.totp.verifyCode(challenge.user, input.code.trim(), input.now)
      : // Código de recuperação não serve para cadastrar as duas etapas: no
        // primeiro acesso ainda não existe nenhum.
        !first && (await this.totp.consumeRecoveryCode(challenge.user.id, input.code, input.now));

    if (!accepted) {
      await this.challenges.countAttempt(challenge.id);
      await this.lockout.registerFailure(email, input.client.ip, "WRONG_CODE", input.now);
      throw new InvalidCodeError();
    }

    if (first) await this.totp.activate(challenge.user.id, input.now);
    await this.challenges.complete(challenge.id, input.now);

    const session = await this.sessions.create({
      userId: challenge.user.id,
      ip: input.client.ip,
      userAgent: input.client.userAgent,
      now: input.now,
    });
    await this.lockout.registerSuccess(email, input.client.ip);

    return {
      token: session.token,
      expiresAt: session.expiresAt.toISOString(),
      user: await this.sessionUser(challenge.user.id),
      // Os 10 códigos existem em claro uma única vez na vida, aqui.
      ...(first ? { recoveryCodes: await this.totp.issueRecoveryCodes(challenge.user.id) } : {}),
    };
  }

  /** Confirmação recente: um código novo para liberar ação administrativa. */
  async confirm(auth: AuthContext, code: string, now: Date): Promise<Date> {
    const user = await this.prisma.db.user.findUniqueOrThrow({
      where: { id: auth.userId },
      select: { id: true, totpSecretEncrypted: true, totpLastStep: true },
    });

    const ok = await this.totp.verifyCode(user, code.trim(), now);
    if (!ok) {
      // Erro de código aqui conta igual: é a mesma porta, pedida de dentro.
      await this.lockout.registerFailure(auth.email, null, "WRONG_CODE", now);
      throw new InvalidCodeError();
    }

    await this.sessions.markVerified(auth.sessionId, now);
    return now;
  }

  /**
   * Trocar a senha exige senha atual **e** código do aplicativo, e derruba as
   * outras sessões: se a senha estava comprometida, quem entrou com ela sai.
   */
  async changePassword(
    auth: AuthContext,
    input: { currentPassword: string; newPassword: string; code: string },
    now: Date,
  ): Promise<number> {
    const user = await this.prisma.db.user.findUniqueOrThrow({ where: { id: auth.userId } });

    if (!(await verifyPassword(user.passwordHash, input.currentPassword))) throw new InvalidCredentialsError();
    if (!(await this.totp.verifyCode(user, input.code.trim(), now))) throw new InvalidCodeError();

    // Delega em vez de gravar aqui: `setPassword` é o único lugar que escreve
    // senha, e é ele que carimba `passwordSetAt`. Ele confere a política de
    // novo, o que mantém a ordem dos erros — senha atual, código, política.
    await this.users.setPassword(user.id, user.email, input.newPassword, now);
    await this.sessions.markVerified(auth.sessionId, now);

    return this.sessions.revokeAllForUser(user.id, "PASSWORD_CHANGE", now, auth.sessionId);
  }

  /** Gerar códigos novos exige código do aplicativo e invalida os anteriores. */
  async regenerateRecoveryCodes(auth: AuthContext, code: string, now: Date): Promise<string[]> {
    await this.confirm(auth, code, now);
    return this.totp.issueRecoveryCodes(auth.userId);
  }

  private async sessionUser(userId: string): Promise<SessionUser> {
    const user = await this.prisma.db.user.findUniqueOrThrow({
      where: { id: userId },
      include: { permissions: { select: { permission: true } } },
    });

    return {
      id: user.id,
      name: user.name,
      email: user.email,
      superAdmin: user.superAdmin,
      permissions: user.permissions.map((row) => row.permission),
    };
  }
}
