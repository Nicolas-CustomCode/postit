import { Inject, Injectable } from "@nestjs/common";
import type { ChallengePurpose } from "@repo/database";
import { randomToken, sha256Hex } from "../common/crypto";
import { ChallengeInvalidError } from "../common/errors";
import { challengeExpiry, challengeState } from "../domain/auth/challenge";
import { PrismaService } from "../prisma/prisma.service";
import { AUTH_CONFIG, type AuthConfig } from "./auth.config";

/** O desafio com o dono junto — quem chama precisa do e-mail para o bloqueio. */
export interface LoadedChallenge {
  readonly id: string;
  readonly purpose: ChallengePurpose;
  readonly user: {
    readonly id: string;
    readonly email: string;
    readonly totpSecretEncrypted: string | null;
    readonly totpEnabledAt: Date | null;
    readonly totpLastStep: bigint | null;
  };
}

/**
 * O desafio entre a senha e o código (ADR 0013, seção 2).
 *
 * Existe para que senha certa sozinha não vire sessão. Vale poucos minutos,
 * poucas tentativas, e é de uso único.
 */
@Injectable()
export class ChallengeService {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(AUTH_CONFIG) private readonly config: AuthConfig,
  ) {}

  async start(userId: string, purpose: ChallengePurpose, now: Date): Promise<{ token: string; expiresAt: Date }> {
    const token = randomToken();
    const expiresAt = challengeExpiry(now, this.config.challengeTtlMinutes);

    await this.prisma.db.loginChallenge.create({
      data: { userId, tokenHash: sha256Hex(token), purpose, expiresAt },
    });

    return { token, expiresAt };
  }

  /**
   * Inexistente, vencido, esgotado e já usado dão o MESMO erro: para quem está
   * na tela, todos significam "comece de novo".
   */
  async load(token: string, now: Date): Promise<LoadedChallenge> {
    const challenge = await this.prisma.db.loginChallenge.findUnique({
      where: { tokenHash: sha256Hex(token) },
      include: {
        user: {
          select: {
            id: true,
            email: true,
            totpSecretEncrypted: true,
            totpEnabledAt: true,
            totpLastStep: true,
            deactivatedAt: true,
          },
        },
      },
    });

    if (challenge === null) throw new ChallengeInvalidError();
    if (challengeState(challenge, now, this.config.challengeMaxAttempts) !== "USABLE") throw new ChallengeInvalidError();
    // Desativado entre a senha e o código não completa o login: o desafio foi
    // criado antes, e sem esta linha ele valeria por mais cinco minutos.
    if (challenge.user.deactivatedAt !== null) throw new ChallengeInvalidError();

    return { id: challenge.id, purpose: challenge.purpose, user: challenge.user };
  }

  /** Código errado gasta uma tentativa. Cinco erradas encerram o desafio. */
  async countAttempt(challengeId: string): Promise<void> {
    await this.prisma.db.loginChallenge.update({
      where: { id: challengeId },
      data: { attempts: { increment: 1 } },
    });
  }

  async complete(challengeId: string, now: Date): Promise<void> {
    await this.prisma.db.loginChallenge.update({ where: { id: challengeId }, data: { completedAt: now } });
  }
}
