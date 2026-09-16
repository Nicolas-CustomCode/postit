import { Inject, Injectable } from "@nestjs/common";
import type { AccessLinkInfo, AccessLinkPurpose } from "@repo/shared";
import { randomToken, sha256Hex } from "../common/crypto";
import { AccessLinkInvalidError } from "../common/errors";
import { isLinkUsable, linkExpiry } from "../domain/auth/access-link";
import { PrismaService } from "../prisma/prisma.service";
import { AUTH_CONFIG, type AuthConfig } from "./auth.config";

/**
 * Links de cadastro e de redefinição (ADR 0013, seção 6).
 *
 * O sistema não envia e-mail: o link aparece uma vez, na saída do comando, e é
 * entregue por canal de confiança. Guardado só como hash, de uso único.
 */
@Injectable()
export class LinksService {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(AUTH_CONFIG) private readonly config: AuthConfig,
  ) {}

  /**
   * ⚠️ É aqui que o token em claro sai da API, e é a única saída. O retorno
   * desta função **nunca** vai para log: ele é a credencial.
   */
  async issue(userId: string, purpose: AccessLinkPurpose, now: Date): Promise<{ token: string; expiresAt: Date }> {
    const token = randomToken();
    const expiresAt = linkExpiry(now, purpose, this.config.linkTtl);

    await this.prisma.db.accessLink.create({ data: { userId, tokenHash: sha256Hex(token), purpose, expiresAt } });
    return { token, expiresAt };
  }

  /** A tela mostra de quem é o link antes de pedir a senha nova. */
  async inspect(token: string, purpose: AccessLinkPurpose, now: Date): Promise<AccessLinkInfo> {
    const link = await this.load(token, purpose, now);
    return {
      email: link.user.email,
      name: link.user.name,
      purpose,
      expiresAt: link.expiresAt.toISOString(),
    };
  }

  /**
   * Marca o link como usado, em UPDATE condicional: dois envios do mesmo
   * formulário só consomem uma vez.
   */
  async consume(token: string, purpose: AccessLinkPurpose, now: Date): Promise<{ userId: string; email: string }> {
    const link = await this.load(token, purpose, now);

    const used = await this.prisma.db.accessLink.updateMany({
      where: { id: link.id, usedAt: null },
      data: { usedAt: now },
    });
    if (used.count !== 1) throw new AccessLinkInvalidError();

    return { userId: link.userId, email: link.user.email };
  }

  /**
   * Inexistente, vencido, já usado e de outra finalidade: um erro só. São
   * situações diferentes para quem administra e a mesma para quem abriu um
   * endereço que não vale mais.
   */
  private async load(token: string, purpose: AccessLinkPurpose, now: Date) {
    const link = await this.prisma.db.accessLink.findUnique({
      where: { tokenHash: sha256Hex(token) },
      include: { user: { select: { email: true, name: true, deactivatedAt: true } } },
    });

    if (link === null) throw new AccessLinkInvalidError();
    if (!isLinkUsable(link, purpose, now)) throw new AccessLinkInvalidError();
    if (link.user.deactivatedAt !== null) throw new AccessLinkInvalidError();
    return link;
  }
}
