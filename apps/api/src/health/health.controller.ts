import { Controller, Get } from "@nestjs/common";
import { VERSION } from "@repo/shared";
import { PrismaService } from "../prisma/prisma.service";

export interface HealthResponse {
  version: string;
  database: "ok" | "unavailable";
}

/**
 * GET /health — estado da infraestrutura para a verificação de fumaça do deploy.
 *
 * Exige a chave interna, como qualquer rota. O painel de saúde do negócio (RF-H02)
 * é outra coisa e vem na Fase 5. O estado do MinIO entra com o módulo de armazenamento.
 */
@Controller("health")
export class HealthController {
  constructor(private readonly prisma: PrismaService) {}

  @Get()
  async check(): Promise<HealthResponse> {
    let database: HealthResponse["database"] = "ok";
    try {
      await this.prisma.db.$queryRaw`SELECT 1`;
    } catch {
      database = "unavailable";
    }
    return { version: VERSION, database };
  }
}
