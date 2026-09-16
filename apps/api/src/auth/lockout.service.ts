import { Inject, Injectable } from "@nestjs/common";
import type { AccessResult } from "@repo/database";
import { AccessBlockedError } from "../common/errors";
import { activeBlock, decideBlock, repeatWindowStart, windowStart, type BlockType } from "../domain/auth/lockout";
import { PrismaService } from "../prisma/prisma.service";
import { AUTH_CONFIG, type AuthConfig } from "./auth.config";

/** A coluna `ip` de TentativaAcesso não aceita nulo, e chamada sem proxy existe. */
export const UNKNOWN_IP = "desconhecido";

/**
 * Proteção contra tentativas repetidas (ADR 0013, seção 5).
 *
 * ⚠️ A ordem de uso é obrigatória: `ensureNotBlocked` ANTES de conferir a senha.
 * Conferir depois deixa acertar a senha furar um bloqueio ativo.
 */
@Injectable()
export class LockoutService {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(AUTH_CONFIG) private readonly config: AuthConfig,
  ) {}

  /** Recusa com 429 e o horário de liberação, se houver bloqueio valendo. */
  async ensureNotBlocked(email: string, ip: string | null, now: Date): Promise<void> {
    const blocks = await this.prisma.db.accessBlock.findMany({
      where: {
        releasedAt: null,
        until: { gt: now },
        OR: [
          { type: "ACCOUNT", key: email },
          ...(ip === null ? [] : [{ type: "IP" as const, key: ip }]),
        ],
      },
      select: { until: true, releasedAt: true },
    });

    const block = activeBlock(blocks, now);
    if (block !== null) throw new AccessBlockedError(block.until);
  }

  /** Registra a tentativa. Nunca recebe a senha nem o código — só o resultado. */
  async registerAttempt(email: string, ip: string | null, result: AccessResult): Promise<void> {
    await this.prisma.db.accessAttempt.create({ data: { email, ip: ip ?? UNKNOWN_IP, result } });
  }

  /**
   * Conta as falhas da janela e cria o bloqueio quando o limite estoura.
   *
   * Duas camadas independentes: a conta (chave é o e-mail) e o IP. Um e-mail
   * inexistente só conta no IP — é digitação de quem está varrendo, não de quem
   * errou a própria senha.
   */
  async registerFailure(email: string, ip: string | null, result: AccessResult, now: Date): Promise<void> {
    await this.registerAttempt(email, ip, result);

    if (result !== "UNKNOWN_EMAIL") await this.applyLimit("ACCOUNT", email, now);
    if (ip !== null) await this.applyLimit("IP", ip, now);
  }

  /** Login completo zera a contagem: o acerto apaga a punição daquele balde. */
  async registerSuccess(email: string, ip: string | null): Promise<void> {
    await this.registerAttempt(email, ip, "SUCCESS");
  }

  private async applyLimit(type: BlockType, key: string, now: Date): Promise<void> {
    const start = windowStart(now, this.config.lockout);
    // A contagem recomeça no último sucesso daquele balde: é assim que "entrar
    // zera a contagem" acontece sem apagar linha nenhuma do histórico.
    const lastSuccess = await this.prisma.db.accessAttempt.findFirst({
      where: { result: "SUCCESS", createdAt: { gte: start }, ...(type === "ACCOUNT" ? { email: key } : { ip: key }) },
      orderBy: { createdAt: "desc" },
      select: { createdAt: true },
    });

    const from = lastSuccess === null ? start : lastSuccess.createdAt;
    const failuresInWindow = await this.prisma.db.accessAttempt.count({
      where: { result: { not: "SUCCESS" }, createdAt: { gt: from }, ...(type === "ACCOUNT" ? { email: key } : { ip: key }) },
    });

    const blockedRecently =
      (await this.prisma.db.accessBlock.count({
        where: { type, key, createdAt: { gte: repeatWindowStart(now, this.config.lockout) } },
      })) > 0;

    const decision = decideBlock({ type, failuresInWindow, blockedRecently, now, config: this.config.lockout });
    if (decision === null) return;

    await this.prisma.db.accessBlock.create({
      data: { type, key, level: decision.level, until: decision.until },
    });
  }
}
