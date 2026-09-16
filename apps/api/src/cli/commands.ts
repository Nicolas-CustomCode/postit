import type { INestApplicationContext } from "@nestjs/common";
import { normalizeEmail } from "@repo/shared";
import { AuditService } from "../audit/audit.service";
import { LinksService } from "../auth/links.service";
import { SessionService } from "../auth/session.service";
import { TotpService } from "../auth/totp.service";
import { PrismaService } from "../prisma/prisma.service";
import { UsersService } from "../users/users.service";

/**
 * Os comandos de administração (ADR 0013, seção 6; ADR 0015, seção 5).
 *
 * São a saída de emergência: quem tem acesso ao servidor consegue criar o
 * primeiro usuário, promover alguém e devolver o acesso de quem perdeu o celular
 * — sem que o sistema precise enviar e-mail.
 *
 * Cada função devolve as linhas a imprimir. Quem imprime é o `main.ts`, e é lá
 * que o link em claro aparece — uma vez só, nunca em log.
 */

export interface CommandResult {
  readonly lines: readonly string[];
}

/** O link que a pessoa vai abrir. As rotas das telas são em português. */
function linkUrl(appUrl: string, path: "cadastro" | "redefinir", token: string): string {
  return `${appUrl.replace(/\/$/, "")}/${path}/${token}`;
}

export async function createUser(
  app: INestApplicationContext,
  input: { email: string; name: string; superAdmin: boolean; appUrl: string },
): Promise<CommandResult> {
  const users = app.get(UsersService);
  const links = app.get(LinksService);
  const audit = app.get(AuditService);

  const email = normalizeEmail(input.email);
  if ((await users.byEmail(email)) !== null) throw new Error(`Já existe usuário com o e-mail ${email}`);

  const user = await users.create({ email, name: input.name, superAdmin: input.superAdmin });
  const link = await links.issue(user.id, "SIGNUP", new Date());
  await audit.record({
    authorId: null,
    origin: "CLI",
    action: "USER_CREATED",
    targetType: "Usuario",
    targetId: user.id,
    details: { email, superAdmin: input.superAdmin },
  });

  return {
    lines: [
      `Usuário criado: ${user.name} <${email}>${input.superAdmin ? " (super admin)" : ""}`,
      "",
      "Link de cadastro, válido por 7 dias e de uso único:",
      linkUrl(input.appUrl, "cadastro", link.token),
      "",
      "Entregue por um canal de confiança. Quem tiver este link define a senha.",
    ],
  };
}

export async function promoteUser(app: INestApplicationContext, email: string): Promise<CommandResult> {
  const users = app.get(UsersService);
  const audit = app.get(AuditService);

  const user = await requireUser(app, email);
  await users.promoteToSuperAdmin(user.id);
  await audit.record({
    authorId: null,
    origin: "CLI",
    action: "SUPER_ADMIN_PROMOTED",
    targetType: "Usuario",
    targetId: user.id,
    details: { email: user.email },
  });

  return { lines: [`${user.email} agora é super admin.`] };
}

/** Redefinir senha derruba todas as sessões; a verificação em duas etapas fica. */
export async function resetPassword(
  app: INestApplicationContext,
  email: string,
  appUrl: string,
): Promise<CommandResult> {
  const links = app.get(LinksService);
  const sessions = app.get(SessionService);
  const audit = app.get(AuditService);

  const now = new Date();
  const user = await requireUser(app, email);
  const link = await links.issue(user.id, "PASSWORD_RESET", now);
  const revoked = await sessions.revokeAllForUser(user.id, "PASSWORD_RESET", now);
  await audit.record({
    authorId: null,
    origin: "CLI",
    action: "RESET_LINK_CREATED",
    targetType: "Usuario",
    targetId: user.id,
    details: { email: user.email, sessoesEncerradas: revoked },
  });

  return {
    lines: [
      `Sessões encerradas: ${revoked}`,
      "",
      "Link de redefinição, válido por 24 horas e de uso único:",
      linkUrl(appUrl, "redefinir", link.token),
    ],
  };
}

/** Para quem perdeu o celular E os códigos de recuperação. */
export async function resetTwoFactor(app: INestApplicationContext, email: string): Promise<CommandResult> {
  const totp = app.get(TotpService);
  const sessions = app.get(SessionService);
  const audit = app.get(AuditService);

  const now = new Date();
  const user = await requireUser(app, email);
  await totp.reset(user.id);
  const revoked = await sessions.revokeAllForUser(user.id, "TWO_FACTOR_RESET", now);
  await audit.record({
    authorId: null,
    origin: "CLI",
    action: "TWO_FACTOR_RESET",
    targetType: "Usuario",
    targetId: user.id,
    details: { email: user.email, sessoesEncerradas: revoked },
  });

  return {
    lines: [
      `Verificação em duas etapas apagada para ${user.email}.`,
      `Sessões encerradas: ${revoked}`,
      "No próximo login, a pessoa cadastra o aplicativo de novo.",
    ],
  };
}

async function requireUser(app: INestApplicationContext, email: string) {
  const user = await app.get(PrismaService).db.user.findUnique({ where: { email: normalizeEmail(email) } });
  if (user === null) throw new Error(`Não há usuário com o e-mail ${normalizeEmail(email)}`);
  return user;
}
