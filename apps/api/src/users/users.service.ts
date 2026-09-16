import { Injectable } from "@nestjs/common";
import { normalizeEmail, passwordProblem } from "@repo/shared";
import { LastSuperAdminError, PasswordPolicyError, SelfDeactivationError } from "../common/errors";
import { refuseRemoval } from "../domain/admin/super-admin";
import { hashPassword } from "../auth/password";
import { PrismaService } from "../prisma/prisma.service";

/**
 * Usuários: criação, senha e super admin.
 *
 * A tela de administração é da Fase 4; no Bloco B quem chama isto são os
 * comandos admin:* e a troca de senha do próprio usuário.
 */
@Injectable()
export class UsersService {
  constructor(private readonly prisma: PrismaService) {}

  byEmail(email: string) {
    return this.prisma.db.user.findUnique({ where: { email: normalizeEmail(email) } });
  }

  /** Nasce sem senha: quem define é a própria pessoa, pelo link de cadastro. */
  async create(input: { email: string; name: string; superAdmin: boolean }) {
    return this.prisma.db.user.create({
      data: { email: normalizeEmail(input.email), name: input.name, superAdmin: input.superAdmin },
    });
  }

  /**
   * Define a senha, conferindo a política antes de gastar o argon2.
   *
   * A política é a mesma função que a tela usa (@repo/shared), e é o que faz o
   * formulário e a API concordarem sobre o que é uma senha aceitável.
   */
  async setPassword(userId: string, email: string, password: string): Promise<void> {
    const problem = passwordProblem(password, email);
    if (problem !== null) throw new PasswordPolicyError(problem);

    await this.prisma.db.user.update({ where: { id: userId }, data: { passwordHash: await hashPassword(password) } });
  }

  async promoteToSuperAdmin(userId: string): Promise<void> {
    await this.prisma.db.user.update({ where: { id: userId }, data: { superAdmin: true } });
  }

  /**
   * Desativar ou rebaixar super admin passa pela invariante I-10: nunca zero
   * super admin ativo.
   *
   * ⚠️ A contagem é lida DENTRO da transação, e o nível é `Serializable`. Com o
   * padrão do Postgres (Read Committed), duas desativações simultâneas leem "2"
   * cada uma e passam as duas — e o sistema fica sem ninguém que possa
   * administrá-lo.
   */
  async deactivate(actorId: string, targetId: string, now: Date): Promise<void> {
    try {
      await this.deactivateOnce(actorId, targetId, now);
    } catch (error) {
      // P2034: o Postgres desistiu de uma das duas transações simultâneas
      // (serialization_failure). Repetir uma vez basta: na segunda leitura a
      // contagem já reflete a outra desativação, e a invariante decide de novo —
      // com o resultado certo, que pode ser recusar.
      if (!isSerializationFailure(error)) throw error;
      await this.deactivateOnce(actorId, targetId, now);
    }
  }

  private async deactivateOnce(actorId: string, targetId: string, now: Date): Promise<void> {
    await this.prisma.db.$transaction(
      async (tx) => {
        const target = await tx.user.findUniqueOrThrow({
          where: { id: targetId },
          select: { superAdmin: true, deactivatedAt: true },
        });
        const activeSuperAdmins = await tx.user.count({ where: { superAdmin: true, deactivatedAt: null } });

        const refusal = refuseRemoval({
          actorId,
          targetId,
          targetIsSuperAdmin: target.superAdmin && target.deactivatedAt === null,
          activeSuperAdmins,
        });
        if (refusal === "SELF") throw new SelfDeactivationError();
        if (refusal === "LAST_SUPER_ADMIN") throw new LastSuperAdminError();

        await tx.user.update({
          where: { id: targetId },
          data: { deactivatedAt: now, deactivatedById: actorId },
        });
      },
      { isolationLevel: "Serializable" },
    );
  }
}

function isSerializationFailure(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && (error as { code: unknown }).code === "P2034";
}
