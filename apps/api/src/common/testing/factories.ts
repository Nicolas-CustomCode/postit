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

export interface TestAccount {
  readonly id: string;
  readonly username: string;
}

/**
 * Conta do Instagram conectada, como o OAuth a deixaria.
 *
 * O token é falso, mas passa pela cifra de verdade: é assim que o teste prova
 * que a leitura nunca devolve o conteúdo da coluna.
 */
export async function createTestAccount(
  db: PrismaClient,
  encryptionKey: Buffer,
  options: {
    username?: string;
    name?: string;
    timezone?: string;
    /** Quando o token vence. Serve para exercitar o aviso do seletor. */
    tokenExpiresAt?: Date;
    photoObjectKey?: string | null;
    active?: boolean;
  } = {},
): Promise<TestAccount> {
  const username = options.username ?? `conta.teste.${Math.random().toString(36).slice(2, 8)}`;

  const account = await db.account.create({
    data: {
      network: "INSTAGRAM",
      externalId: `1784140${Math.floor(Math.random() * 1_000_000_000)}`,
      username,
      name: options.name ?? "Conta de Teste",
      photoObjectKey: options.photoObjectKey === undefined ? null : options.photoObjectKey,
      tokenEncrypted: encryptSecret("token-falso-de-teste", encryptionKey, "instagram-token"),
      tokenExpiresAt: options.tokenExpiresAt ?? new Date(Date.now() + 60 * 24 * 60 * 60 * 1000),
      scopes: "instagram_business_basic,instagram_business_content_publish,instagram_business_manage_insights",
      timezone: options.timezone ?? "America/Sao_Paulo",
      active: options.active ?? true,
    },
  });

  return { id: account.id, username: account.username };
}

/**
 * O código que o aplicativo autenticador mostraria agora — ou em outro passo,
 * para testar a tolerância de relógio e o reuso.
 */
export function totpCodeFor(secret: string, stepOffset = 0): string {
  const epoch = Math.floor(Date.now() / 1000) + stepOffset * 30;
  return generateSync({ secret, epoch });
}
