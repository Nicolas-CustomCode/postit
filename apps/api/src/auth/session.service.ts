import { Inject, Injectable } from "@nestjs/common";
import type { RevocationReason } from "@repo/database";
import type { ActiveSession, Permission } from "@repo/shared";
import { randomToken, sha256Hex } from "../common/crypto";
import { isRecentlyConfirmed } from "../domain/auth/recent-confirmation";
import { sessionExpiry, sessionState, shouldTouch, TOUCH_INTERVAL_MS } from "../domain/auth/session-validity";
import { PrismaService } from "../prisma/prisma.service";
import { AUTH_CONFIG, type AuthConfig } from "./auth.config";

/** Quem está do outro lado, já com as permissões efetivas resolvidas. */
export interface AuthContext {
  readonly sessionId: string;
  readonly userId: string;
  readonly name: string;
  readonly email: string;
  readonly superAdmin: boolean;
  readonly permissions: readonly Permission[];
  readonly verifiedAt: Date;
  readonly recentlyConfirmed: boolean;
  readonly createdAt: Date;
  readonly expiresAt: Date;
}

/**
 * Sessão opaca (ADR 0013, seção 3).
 *
 * O banco nunca vê o token: guarda o sha256. Um dump do banco não permite se
 * passar por ninguém.
 */
@Injectable()
export class SessionService {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(AUTH_CONFIG) private readonly config: AuthConfig,
  ) {}

  async create(input: {
    userId: string;
    ip: string | null;
    userAgent: string | null;
    now: Date;
  }): Promise<{ token: string; expiresAt: Date }> {
    const token = randomToken();
    // O teto sai da criação e nunca mais é tocado — é o ponto dele.
    const expiresAt = sessionExpiry(input.now, this.config.sessionMaxDays);

    await this.prisma.db.session.create({
      data: {
        userId: input.userId,
        tokenHash: sha256Hex(token),
        ip: input.ip,
        userAgent: input.userAgent,
        expiresAt,
        lastUsedAt: input.now,
        // Nasce confirmada: a sessão só existe depois do código de 6 dígitos.
        verifiedAt: input.now,
      },
    });

    return { token, expiresAt };
  }

  /**
   * Resolve o token numa sessão viva. Devolve `null` para qualquer motivo —
   * revogada, vencida por inatividade ou pelo teto: para quem chama é a mesma
   * coisa, e a diferença não interessa a quem está de fora.
   */
  async resolve(token: string, now: Date): Promise<AuthContext | null> {
    const session = await this.prisma.db.session.findUnique({
      where: { tokenHash: sha256Hex(token) },
      include: { user: { include: { permissions: { select: { permission: true } } } } },
    });
    if (session === null) return null;

    if (sessionState(session, now, this.config.sessionIdleDays) !== "ACTIVE") return null;
    // Usuário desativado no meio da sessão perde o acesso na requisição seguinte.
    if (session.user.deactivatedAt !== null) return null;

    if (shouldTouch(session.lastUsedAt, now)) {
      // A condição vai junto do UPDATE: duas requisições simultâneas gravam a
      // mesma coisa uma vez só, sem ler-modificar-escrever e sem transação.
      await this.prisma.db.session.updateMany({
        where: { id: session.id, lastUsedAt: { lte: new Date(now.getTime() - TOUCH_INTERVAL_MS) } },
        data: { lastUsedAt: now },
      });
    }

    return {
      sessionId: session.id,
      userId: session.userId,
      name: session.user.name,
      email: session.user.email,
      superAdmin: session.user.superAdmin,
      permissions: session.user.permissions.map((row) => row.permission),
      verifiedAt: session.verifiedAt,
      recentlyConfirmed: isRecentlyConfirmed(session.verifiedAt, now, this.config.recentConfirmationMinutes),
      createdAt: session.createdAt,
      expiresAt: session.expiresAt,
    };
  }

  /** Carimba a confirmação recente, depois de a pessoa digitar um código novo. */
  async markVerified(sessionId: string, now: Date): Promise<void> {
    await this.prisma.db.session.update({ where: { id: sessionId }, data: { verifiedAt: now } });
  }

  /** Revogação é lógica e com motivo: apagar destruiria a trilha de incidente. */
  async revoke(sessionId: string, reason: RevocationReason, now: Date): Promise<void> {
    await this.prisma.db.session.updateMany({
      where: { id: sessionId, revokedAt: null },
      data: { revokedAt: now, revocationReason: reason },
    });
  }

  async revokeAllForUser(
    userId: string,
    reason: RevocationReason,
    now: Date,
    exceptSessionId?: string,
  ): Promise<number> {
    const result = await this.prisma.db.session.updateMany({
      where: { userId, revokedAt: null, ...(exceptSessionId === undefined ? {} : { id: { not: exceptSessionId } }) },
      data: { revokedAt: now, revocationReason: reason },
    });
    return result.count;
  }

  /** A tela de sessões ativas, no perfil. Nunca devolve o hash do token. */
  async listActive(userId: string, currentSessionId: string, now: Date): Promise<ActiveSession[]> {
    const sessions = await this.prisma.db.session.findMany({
      where: { userId, revokedAt: null, expiresAt: { gt: now } },
      orderBy: { lastUsedAt: "desc" },
    });

    return sessions
      .filter((session) => sessionState(session, now, this.config.sessionIdleDays) === "ACTIVE")
      .map((session) => ({
        id: session.id,
        createdAt: session.createdAt.toISOString(),
        lastUsedAt: session.lastUsedAt.toISOString(),
        ip: session.ip,
        userAgent: session.userAgent,
        current: session.id === currentSessionId,
      }));
  }
}
