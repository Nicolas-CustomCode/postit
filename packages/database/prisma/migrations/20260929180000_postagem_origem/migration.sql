-- De onde a postagem veio: a tela ou o assistente por MCP (parte 1f, ADR 0029).
-- As que já existem foram todas compostas na tela.

CREATE TYPE "OrigemPostagem" AS ENUM ('TELA', 'ASSISTENTE');

ALTER TABLE "Postagem" ADD COLUMN "origem" "OrigemPostagem" NOT NULL DEFAULT 'TELA';
