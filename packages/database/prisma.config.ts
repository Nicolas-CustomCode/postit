/**
 * Configuração do Prisma 7. A URL do banco saiu do schema e mora aqui.
 *
 * O .env é único e fica na raiz do monorepo (AGENTS.md), e o Prisma 7 não o
 * carrega sozinho — por isso o caminho explícito. Variável já definida no
 * processo vence o arquivo: é assim que a CI e o Easypanel passam a delas.
 */
import { config } from "dotenv";
import path from "node:path";
import { defineConfig } from "prisma/config";

config({ path: path.join(__dirname, "../../.env"), quiet: true });

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations",
    seed: "tsx prisma/seed.ts",
  },
  datasource: {
    url: process.env["DATABASE_URL"],
  },
});
