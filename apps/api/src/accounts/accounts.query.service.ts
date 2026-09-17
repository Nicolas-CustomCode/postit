import { Inject, Injectable } from "@nestjs/common";
import { TOKEN_WARNING_DAYS, type AccountSummary, type AccountWarning } from "@repo/shared";
import { ACCOUNTS_CONFIG, type AccountsConfig } from "./accounts.config";
import { PrismaService } from "../prisma/prisma.service";

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Leitura das contas conectadas.
 *
 * Monta o resumo à mão, campo a campo — nunca devolve o registro do Prisma, que
 * carrega o token cifrado junto.
 */
@Injectable()
export class AccountsQueryService {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(ACCOUNTS_CONFIG) private readonly config: AccountsConfig,
  ) {}

  async list(now: Date): Promise<AccountSummary[]> {
    const accounts = await this.prisma.db.account.findMany({
      where: { active: true },
      orderBy: { username: "asc" },
    });

    return accounts.map((account) => ({
      id: account.id,
      network: account.network,
      username: account.username,
      name: account.name,
      photoUrl: this.photoUrl(account.photoObjectKey),
      timezone: account.timezone,
      tokenExpiresAt: account.tokenExpiresAt.toISOString(),
      tokenExpiresInDays: Math.floor((account.tokenExpiresAt.getTime() - now.getTime()) / DAY_MS),
      warning: warningFor(account.tokenExpiresAt, now),
    }));
  }

  /**
   * A foto fica no nosso armazenamento, no prefixo público. O endereço é montado
   * aqui, e não guardado no banco, porque ele muda junto com o domínio de mídia
   * — no computador local ele é o endereço do túnel, que troca.
   */
  private photoUrl(objectKey: string | null): string | null {
    if (objectKey === null) return null;
    return `${this.config.mediaPublicUrl.replace(/\/$/, "")}/${objectKey}`;
  }
}

function warningFor(tokenExpiresAt: Date, now: Date): AccountWarning | null {
  const remaining = tokenExpiresAt.getTime() - now.getTime();
  if (remaining <= 0) return "TOKEN_EXPIRED";
  if (remaining <= TOKEN_WARNING_DAYS * DAY_MS) return "TOKEN_EXPIRING";
  return null;
}
