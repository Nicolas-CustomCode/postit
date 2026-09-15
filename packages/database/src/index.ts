/**
 * Porta de entrada do banco para a API e o worker.
 *
 * O Prisma 7 exige um adaptador de conexão. `createDatabase` é o único lugar que
 * monta o client, para os dois processos usarem a mesma configuração.
 */
import { PrismaPg } from "@prisma/adapter-pg";
import { Pool } from "pg";
import { PrismaClient } from "./generated/prisma/client";

export * from "./generated/prisma/client";

export interface Database {
  prisma: PrismaClient;
  /** Fecha o client e só resolve quando TODAS as conexões com o Postgres fecharam. */
  close(): Promise<void>;
}

export function createDatabase(databaseUrl: string): Database {
  // O pool é nosso, e não criado pelo adaptador, por causa do fechamento: o
  // pool.end() do pg resolve antes de as conexões terminarem de fechar — ele
  // pede o encerramento de cada uma e não espera. O processo (e o Jest) acabava
  // saindo com um socket do Postgres ainda aberto.
  const pool = new Pool({ connectionString: databaseUrl });
  const prisma = new PrismaClient({ adapter: new PrismaPg(pool) });

  return {
    prisma,
    async close() {
      await prisma.$disconnect();

      // O pool emite "remove" depois que cada conexão terminou de fechar de verdade.
      const pending = pool.totalCount;
      const allRemoved = new Promise<void>((resolve) => {
        if (pending === 0) return resolve();
        let removed = 0;
        pool.on("remove", () => {
          removed += 1;
          if (removed >= pending) resolve();
        });
      });

      await pool.end();
      await allRemoved;
    },
  };
}
