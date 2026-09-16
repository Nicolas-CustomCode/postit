import { Injectable } from "@nestjs/common";
import type { AuditAction, AuditOrigin } from "@repo/database";
import { PrismaService } from "../prisma/prisma.service";

/**
 * Trilha de auditoria (ADR 0015, seção 4).
 *
 * ⚠️ `details` **nunca** carrega link, código, senha ou token. A auditoria é
 * lida por gente, guardada por dois anos e exportada — é o último lugar onde um
 * segredo deveria acabar. Por isso as chaves proibidas são recusadas aqui, e não
 * "combinadas" com quem chama.
 */
const FORBIDDEN_KEYS = ["token", "code", "codigo", "password", "senha", "link", "secret", "segredo"];

export interface AuditInput {
  readonly authorId: string | null;
  readonly origin: AuditOrigin;
  readonly action: AuditAction;
  readonly targetType?: string;
  readonly targetId?: string;
  readonly details?: Record<string, string | number | boolean>;
  readonly ip?: string | null;
}

@Injectable()
export class AuditService {
  constructor(private readonly prisma: PrismaService) {}

  async record(input: AuditInput): Promise<void> {
    assertNoSecrets(input.details);

    await this.prisma.db.auditEvent.create({
      data: {
        authorId: input.authorId,
        origin: input.origin,
        action: input.action,
        targetType: input.targetType ?? null,
        targetId: input.targetId ?? null,
        details: input.details ?? undefined,
        ip: input.ip ?? null,
      },
    });
  }
}

function assertNoSecrets(details: Record<string, unknown> | undefined): void {
  if (details === undefined) return;
  for (const key of Object.keys(details)) {
    if (FORBIDDEN_KEYS.some((forbidden) => key.toLowerCase().includes(forbidden))) {
      // Erro de programação, e proposital: é melhor quebrar no teste do que
      // gravar um segredo que fica dois anos no banco.
      throw new Error(`Auditoria não aceita o campo "${key}"`);
    }
  }
}
