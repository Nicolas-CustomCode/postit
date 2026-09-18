import { Controller, Get } from "@nestjs/common";
import { VERSION } from "@repo/shared";
import { Public } from "../authorization/policy.decorators";
import { PrismaService } from "../prisma/prisma.service";
import { StorageService } from "../storage/storage.service";

export interface HealthResponse {
  version: string;
  database: "ok" | "unavailable";
  storage: "ok" | "unavailable";
}

/**
 * GET /health — estado da infraestrutura para a verificação de fumaça do deploy.
 *
 * Exige a chave interna, como qualquer rota. O painel de saúde do negócio (RF-H02)
 * é outra coisa e vem na Fase 5.
 */
@Controller("health")
export class HealthController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
  ) {}

  // Sem sessão: quem consulta é o deploy, com a chave interna. "Público" aqui
  // significa "não exige login" — a rota continua sem nome na internet.
  @Public()
  @Get()
  async check(): Promise<HealthResponse> {
    let database: HealthResponse["database"] = "ok";
    try {
      await this.prisma.db.$queryRaw`SELECT 1`;
    } catch {
      database = "unavailable";
    }

    const storage = (await this.storage.healthy()) ? "ok" : "unavailable";

    return { version: VERSION, database, storage };
  }
}
