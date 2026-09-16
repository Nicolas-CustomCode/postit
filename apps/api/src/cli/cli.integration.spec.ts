import "reflect-metadata";
import { NestFactory } from "@nestjs/core";
import type { INestApplicationContext } from "@nestjs/common";
import { createTestUser, TEST_PASSWORD } from "../common/testing/factories";
import { resetAuthTables } from "../common/testing/reset-database";
import { testDatabaseUrl } from "../common/testing/test-database";
import { AUTH_CONFIG, type AuthConfig } from "../auth/auth.config";
import { readApiEnv } from "../config/env";
import { PrismaService } from "../prisma/prisma.service";
import { CliModule } from "./cli.module";
import { createUser, promoteUser, resetPassword, resetTwoFactor } from "./commands";

/**
 * Os comandos admin:* (marco 4 da Fase 0).
 *
 * Chamamos as funções diretamente, com o mesmo módulo que o `main.ts` sobe: um
 * `spawn` testaria o npm, não o comando.
 */
describe("comandos admin:*", () => {
  let app: INestApplicationContext;
  let db: PrismaService["db"];
  let config: AuthConfig;
  const APP_URL = "http://localhost:3010";

  beforeAll(async () => {
    const env = readApiEnv({ ...process.env, NODE_ENV: "test", DATABASE_URL: testDatabaseUrl() });
    app = await NestFactory.createApplicationContext(CliModule.forEnv(env), { logger: false });
    db = app.get(PrismaService).db;
    config = app.get<AuthConfig>(AUTH_CONFIG);
  });
  beforeEach(() => resetAuthTables(db));
  afterAll(() => app.close());

  it("cria o primeiro super admin, sem senha, e imprime o link de cadastro", async () => {
    const resultado = await createUser(app, {
      email: "Primeiro@Exemplo.com",
      name: "Primeira Pessoa",
      superAdmin: true,
      appUrl: APP_URL,
    });

    const user = await db.user.findUniqueOrThrow({ where: { email: "primeiro@exemplo.com" } });
    expect(user.superAdmin).toBe(true);
    // Nasce sem senha: quem define é a própria pessoa, pelo link.
    expect(user.passwordHash).toBeNull();

    const saida = resultado.lines.join("\n");
    const token = saida.match(/\/cadastro\/([A-Za-z0-9_-]{43})/)?.[1];
    expect(token).toBeDefined();

    const link = await db.accessLink.findFirstOrThrow({ where: { userId: user.id } });
    expect(link.purpose).toBe("SIGNUP");
    // O banco guarda só o hash: o token existe uma vez, na saída do comando.
    expect(link.tokenHash).not.toBe(token);
    const dias = (link.expiresAt.getTime() - Date.now()) / 86_400_000;
    expect(dias).toBeGreaterThan(6.9);
    expect(dias).toBeLessThanOrEqual(7);
  });

  it("grava auditoria com origem CLI e sem o link", async () => {
    const resultado = await createUser(app, {
      email: "auditado@exemplo.com",
      name: "Auditado",
      superAdmin: false,
      appUrl: APP_URL,
    });

    const evento = await db.auditEvent.findFirstOrThrow();
    expect(evento).toMatchObject({ origin: "CLI", action: "USER_CREATED", authorId: null });
    const token = resultado.lines.join("\n").match(/\/cadastro\/([A-Za-z0-9_-]{43})/)?.[1] as string;
    expect(JSON.stringify(evento)).not.toContain(token);
  });

  it("recusa criar duas vezes o mesmo e-mail", async () => {
    await createUser(app, { email: "repetido@exemplo.com", name: "Um", superAdmin: false, appUrl: APP_URL });
    await expect(
      createUser(app, { email: "repetido@exemplo.com", name: "Outro", superAdmin: false, appUrl: APP_URL }),
    ).rejects.toThrow("Já existe usuário");
  });

  it("promove alguém a super admin", async () => {
    const user = await createTestUser(db, config.encryptionKey);
    await promoteUser(app, user.email);

    expect((await db.user.findUniqueOrThrow({ where: { id: user.id } })).superAdmin).toBe(true);
    expect(await db.auditEvent.count({ where: { action: "SUPER_ADMIN_PROMOTED" } })).toBe(1);
  });

  it("redefinir a senha derruba todas as sessões e não mexe nas duas etapas", async () => {
    const user = await createTestUser(db, config.encryptionKey);
    await db.session.create({
      data: {
        userId: user.id,
        tokenHash: "e".repeat(64),
        expiresAt: new Date(Date.now() + 86_400_000),
        lastUsedAt: new Date(),
        verifiedAt: new Date(),
      },
    });

    const resultado = await resetPassword(app, user.email, APP_URL);
    expect(resultado.lines.join("\n")).toContain("/redefinir/");

    const sessao = await db.session.findFirstOrThrow();
    expect(sessao.revocationReason).toBe("PASSWORD_RESET");
    const depois = await db.user.findUniqueOrThrow({ where: { id: user.id } });
    expect(depois.totpEnabledAt).not.toBeNull();
    expect(depois.totpSecretEncrypted).not.toBeNull();
  });

  it("resetar as duas etapas apaga segredo e códigos e derruba as sessões", async () => {
    const user = await createTestUser(db, config.encryptionKey);
    await db.recoveryCode.create({ data: { userId: user.id, codeHash: "f".repeat(64) } });
    await db.session.create({
      data: {
        userId: user.id,
        tokenHash: "0".repeat(64),
        expiresAt: new Date(Date.now() + 86_400_000),
        lastUsedAt: new Date(),
        verifiedAt: new Date(),
      },
    });

    await resetTwoFactor(app, user.email);

    const depois = await db.user.findUniqueOrThrow({ where: { id: user.id } });
    expect(depois.totpSecretEncrypted).toBeNull();
    expect(depois.totpEnabledAt).toBeNull();
    expect(depois.totpLastStep).toBeNull();
    expect(await db.recoveryCode.count({ where: { userId: user.id } })).toBe(0);
    expect((await db.session.findFirstOrThrow()).revocationReason).toBe("TWO_FACTOR_RESET");
    // A senha continua valendo: quem perdeu o celular não perdeu a senha.
    expect(depois.passwordHash).not.toBeNull();
    expect(TEST_PASSWORD.length).toBeGreaterThan(0);
  });

  it("recusa e-mail inexistente com mensagem clara", async () => {
    await expect(promoteUser(app, "ninguem@exemplo.com")).rejects.toThrow("Não há usuário");
  });
});
