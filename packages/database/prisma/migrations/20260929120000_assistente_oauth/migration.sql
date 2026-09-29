-- O assistente por MCP da parte 1f (ADR 0029, docs/16): o PostIt como servidor OAuth.
-- Clientes (CIMD ou registro dinâmico), a autorização que a pessoa deu, e os códigos e
-- tokens dela — guardados só como sha256.

CREATE TYPE "OrigemClienteOAuth" AS ENUM ('CIMD', 'REGISTRO');
CREATE TYPE "TipoTokenOAuth" AS ENUM ('ACESSO', 'RENOVACAO');
CREATE TYPE "MotivoRevogacaoOAuth" AS ENUM ('PELA_PESSOA', 'PELO_SUPER_ADMIN', 'RENOVACAO_REUSADA');

-- ADD VALUE dentro da transação da migração é aceito a partir do PG 12; os valores
-- novos só não podem ser usados nessa mesma transação, e esta migração não os usa.
ALTER TYPE "AcaoAuditoria" ADD VALUE 'ASSISTENTE_AUTORIZADO';
ALTER TYPE "AcaoAuditoria" ADD VALUE 'ASSISTENTE_REVOGADO';

CREATE TABLE "ClienteOAuth" (
    "id" UUID NOT NULL,
    "identificador" TEXT NOT NULL,
    "origem" "OrigemClienteOAuth" NOT NULL,
    "nome" TEXT NOT NULL,
    "enderecosRetorno" TEXT[],
    "lidaEm" TIMESTAMPTZ(3),
    "criadoEm" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ClienteOAuth_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "AutorizacaoOAuth" (
    "id" UUID NOT NULL,
    "usuarioId" UUID NOT NULL,
    "clienteId" UUID NOT NULL,
    "escopo" TEXT NOT NULL,
    "expiraEm" TIMESTAMPTZ(3) NOT NULL,
    "ultimoUsoEm" TIMESTAMPTZ(3) NOT NULL,
    "revogadaEm" TIMESTAMPTZ(3),
    "motivoRevogacao" "MotivoRevogacaoOAuth",
    "criadaEm" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AutorizacaoOAuth_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "CodigoOAuth" (
    "id" UUID NOT NULL,
    "autorizacaoId" UUID NOT NULL,
    "codigoHash" TEXT NOT NULL,
    "desafioPkce" TEXT NOT NULL,
    "enderecoRetorno" TEXT NOT NULL,
    "recurso" TEXT NOT NULL,
    "expiraEm" TIMESTAMPTZ(3) NOT NULL,
    "usadoEm" TIMESTAMPTZ(3),
    "criadoEm" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CodigoOAuth_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "TokenOAuth" (
    "id" UUID NOT NULL,
    "autorizacaoId" UUID NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "tipo" "TipoTokenOAuth" NOT NULL,
    "expiraEm" TIMESTAMPTZ(3) NOT NULL,
    "usadoEm" TIMESTAMPTZ(3),
    "revogadoEm" TIMESTAMPTZ(3),
    "criadoEm" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TokenOAuth_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ClienteOAuth_identificador_key" ON "ClienteOAuth"("identificador");
CREATE INDEX "AutorizacaoOAuth_usuarioId_revogadaEm_idx" ON "AutorizacaoOAuth"("usuarioId", "revogadaEm");
CREATE UNIQUE INDEX "CodigoOAuth_codigoHash_key" ON "CodigoOAuth"("codigoHash");
CREATE UNIQUE INDEX "TokenOAuth_tokenHash_key" ON "TokenOAuth"("tokenHash");
CREATE INDEX "TokenOAuth_autorizacaoId_idx" ON "TokenOAuth"("autorizacaoId");

ALTER TABLE "AutorizacaoOAuth" ADD CONSTRAINT "AutorizacaoOAuth_usuarioId_fkey"
  FOREIGN KEY ("usuarioId") REFERENCES "Usuario"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "AutorizacaoOAuth" ADD CONSTRAINT "AutorizacaoOAuth_clienteId_fkey"
  FOREIGN KEY ("clienteId") REFERENCES "ClienteOAuth"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "CodigoOAuth" ADD CONSTRAINT "CodigoOAuth_autorizacaoId_fkey"
  FOREIGN KEY ("autorizacaoId") REFERENCES "AutorizacaoOAuth"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "TokenOAuth" ADD CONSTRAINT "TokenOAuth_autorizacaoId_fkey"
  FOREIGN KEY ("autorizacaoId") REFERENCES "AutorizacaoOAuth"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
