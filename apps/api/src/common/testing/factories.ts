import type { PrismaClient } from "@repo/database";
import { generateSync } from "otplib";
import type { Permission } from "@repo/shared";
import { encryptSecret } from "../crypto";
import { hashPassword } from "../../auth/password";
import { newTotpSecret } from "../../auth/totp";

/**
 * Dados prontos para os testes de integração.
 *
 * Ficam aqui, e não em cada arquivo, porque "usuário com as duas etapas
 * cadastradas" aparece em quase todo teste de login — e cada cópia divergiria.
 */

export const TEST_PASSWORD = "senha-de-teste-123";

export interface TestUser {
  readonly id: string;
  readonly email: string;
  readonly totpSecret: string;
}

export async function createTestUser(
  db: PrismaClient,
  encryptionKey: Buffer,
  options: {
    email?: string;
    name?: string;
    password?: string | null;
    withTotp?: boolean;
    superAdmin?: boolean;
    permissions?: readonly Permission[];
    deactivated?: boolean;
  } = {},
): Promise<TestUser> {
  const email = options.email ?? `teste-${Math.random().toString(36).slice(2, 10)}@exemplo.com`;
  const password = options.password === undefined ? TEST_PASSWORD : options.password;
  const secret = newTotpSecret();
  const withTotp = options.withTotp ?? true;

  const user = await db.user.create({
    data: {
      email,
      name: options.name ?? "Pessoa de Teste",
      passwordHash: password === null ? null : await hashPassword(password),
      superAdmin: options.superAdmin ?? false,
      deactivatedAt: options.deactivated === true ? new Date() : null,
      ...(withTotp
        ? {
            totpSecretEncrypted: encryptSecret(secret, encryptionKey, "totp-secret"),
            totpEnabledAt: new Date(),
          }
        : {}),
      ...(options.permissions === undefined
        ? {}
        : { permissions: { create: options.permissions.map((permission) => ({ permission })) } }),
    },
  });

  return { id: user.id, email: user.email, totpSecret: secret };
}

/**
 * O código que o aplicativo autenticador mostraria agora — ou em outro passo,
 * para testar a tolerância de relógio e o reuso.
 */
export function totpCodeFor(secret: string, stepOffset = 0): string {
  const epoch = Math.floor(Date.now() / 1000) + stepOffset * 30;
  return generateSync({ secret, epoch });
}
