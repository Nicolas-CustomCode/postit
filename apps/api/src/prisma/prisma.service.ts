import { Injectable, OnModuleDestroy } from "@nestjs/common";
import { createDatabase, type Database, type PrismaClient } from "@repo/database";

/**
 * O acesso ao banco dos dois processos, API e worker.
 *
 * Composição em vez de herdar do PrismaClient: o client do Prisma 7 é montado por
 * createDatabase, com o adaptador de conexão, e o serviço só o expõe.
 */
@Injectable()
export class PrismaService implements OnModuleDestroy {
  private readonly database: Database;

  constructor(databaseUrl: string) {
    this.database = createDatabase(databaseUrl);
  }

  get db(): PrismaClient {
    return this.database.prisma;
  }

  // No SIGTERM (enableShutdownHooks) e no fim dos testes: espera cada conexão
  // com o Postgres fechar antes de o processo seguir.
  async onModuleDestroy(): Promise<void> {
    await this.database.close();
  }
}
