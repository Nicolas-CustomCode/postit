import { Injectable } from "@nestjs/common";
import type { SecurityOverview } from "@repo/shared";
import { PrismaService } from "../prisma/prisma.service";

/**
 * O estado de segurança da própria conta, para a tela de Perfil.
 *
 * Só lê. Monta a resposta campo a campo e usa `select` explícito — um `include`,
 * ou o registro inteiro, traria `senhaHash` e `totpSegredoCifrado` junto
 * (AGENTS.md, regra 3). Um teste de integração confere que nenhum hash aparece
 * no JSON.
 *
 * Os códigos de recuperação vêm como filhos da mesma consulta, e não num
 * `count` separado: são no máximo dez linhas, e uma ida ao banco basta.
 * `CodigoRecuperacao` não tem índice por usuário — numa tabela de dezenas de
 * linhas numa ferramenta interna, a varredura custa menos que a migração.
 */
@Injectable()
export class SecurityQueryService {
  constructor(private readonly prisma: PrismaService) {}

  async overview(userId: string): Promise<SecurityOverview> {
    const user = await this.prisma.db.user.findUniqueOrThrow({
      where: { id: userId },
      select: {
        createdAt: true,
        passwordSetAt: true,
        totpEnabledAt: true,
        recoveryCodes: { select: { usedAt: true } },
      },
    });

    return {
      memberSince: user.createdAt.toISOString(),
      passwordSetAt: user.passwordSetAt?.toISOString() ?? null,
      twoFactorEnabledAt: user.totpEnabledAt?.toISOString() ?? null,
      recoveryCodesRemaining: user.recoveryCodes.filter((codigo) => codigo.usedAt === null).length,
      recoveryCodesTotal: user.recoveryCodes.length,
    };
  }
}
