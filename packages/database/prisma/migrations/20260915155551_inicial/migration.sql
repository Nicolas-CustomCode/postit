-- CreateEnum
CREATE TYPE "RedeSocial" AS ENUM ('INSTAGRAM');

-- CreateEnum
CREATE TYPE "FormatoPostagem" AS ENUM ('FEED_IMAGEM', 'FEED_VIDEO', 'CARROSSEL', 'REELS', 'STORIES');

-- CreateEnum
CREATE TYPE "StatusPostagem" AS ENUM ('RASCUNHO', 'EM_REVISAO', 'APROVADO', 'AGENDADO', 'PROCESSANDO', 'PUBLICADO', 'FALHOU', 'CANCELADO');

-- CreateEnum
CREATE TYPE "PapelContainer" AS ENUM ('UNICO', 'PAI', 'FILHO');

-- CreateEnum
CREATE TYPE "StatusContainer" AS ENUM ('IN_PROGRESS', 'FINISHED', 'ERROR', 'EXPIRED', 'PUBLISHED');

-- CreateEnum
CREATE TYPE "MomentoMetrica" AS ENUM ('T1H', 'T24H', 'T7D', 'STORY_20H');

-- CreateEnum
CREATE TYPE "AcaoAprovacao" AS ENUM ('ENVIOU_REVISAO', 'APROVOU', 'REPROVOU', 'INVALIDOU_POR_EDICAO');

-- CreateEnum
CREATE TYPE "EtapaPublicacao" AS ENUM ('CRIAR_CONTAINER', 'CONSULTAR_STATUS', 'PUBLICAR', 'COLETAR_METRICAS');

-- CreateEnum
CREATE TYPE "ResultadoEtapa" AS ENUM ('SUCESSO', 'ERRO_RECUPERAVEL', 'ERRO_FATAL');

-- CreateEnum
CREATE TYPE "AcaoToken" AS ENUM ('TROCA_LONGA_DURACAO', 'RENOVACAO');

-- CreateEnum
CREATE TYPE "MotivoRevogacao" AS ENUM ('SAIU', 'TROCA_SENHA', 'REDEFINICAO_SENHA', 'RESET_2FA', 'ENCERRADA_PELO_USUARIO');

-- CreateEnum
CREATE TYPE "FinalidadeDesafio" AS ENUM ('CADASTRAR_2FA', 'VERIFICAR_2FA');

-- CreateEnum
CREATE TYPE "FinalidadeLink" AS ENUM ('CADASTRO', 'REDEFINICAO_SENHA');

-- CreateEnum
CREATE TYPE "ResultadoAcesso" AS ENUM ('SUCESSO', 'SENHA_ERRADA', 'EMAIL_INEXISTENTE', 'CODIGO_ERRADO', 'BLOQUEADO');

-- CreateEnum
CREATE TYPE "TipoBloqueio" AS ENUM ('CONTA', 'IP');

-- CreateEnum
CREATE TYPE "TipoNotificacao" AS ENUM ('PUBLICACAO_FALHOU', 'AGUARDANDO_APROVACAO', 'TOKEN_EXPIRANDO', 'CONTA_SEM_ACESSO', 'PROCESSAMENTO_TRAVADO', 'CONTA_BLOQUEADA');

-- CreateEnum
CREATE TYPE "Permissao" AS ENUM ('POSTAGEM_EDITAR', 'POSTAGEM_APROVAR', 'POSTAGEM_APROVAR_PROPRIA', 'POSTAGEM_AGENDAR', 'CONTA_GERENCIAR');

-- CreateEnum
CREATE TYPE "OrigemAuditoria" AS ENUM ('WEB', 'CLI');

-- CreateEnum
CREATE TYPE "AcaoAuditoria" AS ENUM ('USUARIO_CRIADO', 'USUARIO_DESATIVADO', 'USUARIO_REATIVADO', 'SUPER_ADMIN_PROMOVIDO', 'SUPER_ADMIN_REMOVIDO', 'PERMISSOES_ALTERADAS', 'LINK_REDEFINICAO_GERADO', 'DUAS_ETAPAS_RESETADAS', 'SESSOES_ENCERRADAS', 'BLOQUEIO_LIBERADO');

-- CreateTable
CREATE TABLE "Usuario" (
    "id" UUID NOT NULL,
    "email" TEXT NOT NULL,
    "nome" TEXT NOT NULL,
    "senhaHash" TEXT,
    "totpSegredoCifrado" TEXT,
    "totpAtivadoEm" TIMESTAMPTZ(3),
    "totpUltimoPasso" BIGINT,
    "superAdmin" BOOLEAN NOT NULL DEFAULT false,
    "desativadoEm" TIMESTAMPTZ(3),
    "desativadoPorId" UUID,
    "criadoEm" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Usuario_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PermissaoUsuario" (
    "id" UUID NOT NULL,
    "usuarioId" UUID NOT NULL,
    "permissao" "Permissao" NOT NULL,
    "concedidaPorId" UUID,
    "concedidaEm" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PermissaoUsuario_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Sessao" (
    "id" UUID NOT NULL,
    "usuarioId" UUID NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "ip" TEXT,
    "navegador" TEXT,
    "expiraEm" TIMESTAMPTZ(3) NOT NULL,
    "ultimoUsoEm" TIMESTAMPTZ(3) NOT NULL,
    "verificadoEm" TIMESTAMPTZ(3) NOT NULL,
    "revogadaEm" TIMESTAMPTZ(3),
    "motivoRevogacao" "MotivoRevogacao",
    "criadoEm" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Sessao_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DesafioLogin" (
    "id" UUID NOT NULL,
    "usuarioId" UUID NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "finalidade" "FinalidadeDesafio" NOT NULL,
    "tentativas" INTEGER NOT NULL DEFAULT 0,
    "expiraEm" TIMESTAMPTZ(3) NOT NULL,
    "concluidoEm" TIMESTAMPTZ(3),
    "criadoEm" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DesafioLogin_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CodigoRecuperacao" (
    "id" UUID NOT NULL,
    "usuarioId" UUID NOT NULL,
    "codigoHash" TEXT NOT NULL,
    "usadoEm" TIMESTAMPTZ(3),
    "criadoEm" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CodigoRecuperacao_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LinkAcesso" (
    "id" UUID NOT NULL,
    "usuarioId" UUID NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "finalidade" "FinalidadeLink" NOT NULL,
    "expiraEm" TIMESTAMPTZ(3) NOT NULL,
    "usadoEm" TIMESTAMPTZ(3),
    "criadoEm" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LinkAcesso_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TentativaAcesso" (
    "id" UUID NOT NULL,
    "email" TEXT NOT NULL,
    "ip" TEXT NOT NULL,
    "resultado" "ResultadoAcesso" NOT NULL,
    "criadoEm" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TentativaAcesso_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BloqueioAcesso" (
    "id" UUID NOT NULL,
    "tipo" "TipoBloqueio" NOT NULL,
    "chave" TEXT NOT NULL,
    "nivel" INTEGER NOT NULL,
    "ate" TIMESTAMPTZ(3) NOT NULL,
    "liberadoEm" TIMESTAMPTZ(3),
    "liberadoPorId" UUID,
    "criadoEm" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BloqueioAcesso_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EventoAuditoria" (
    "id" UUID NOT NULL,
    "autorId" UUID,
    "origem" "OrigemAuditoria" NOT NULL,
    "acao" "AcaoAuditoria" NOT NULL,
    "alvoTipo" TEXT,
    "alvoId" TEXT,
    "detalhes" JSONB,
    "ip" TEXT,
    "criadoEm" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EventoAuditoria_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Conta" (
    "id" UUID NOT NULL,
    "rede" "RedeSocial" NOT NULL,
    "idExterno" TEXT NOT NULL,
    "username" TEXT NOT NULL,
    "nome" TEXT,
    "fotoChaveObjeto" TEXT,
    "tokenCifrado" TEXT NOT NULL,
    "tokenExpiraEm" TIMESTAMPTZ(3) NOT NULL,
    "tokenRenovadoEm" TIMESTAMPTZ(3),
    "escopos" TEXT NOT NULL,
    "fusoHorario" TEXT NOT NULL,
    "ativa" BOOLEAN NOT NULL DEFAULT true,
    "criadoEm" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Conta_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Midia" (
    "id" UUID NOT NULL,
    "chaveObjeto" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "bytes" INTEGER NOT NULL,
    "largura" INTEGER NOT NULL,
    "altura" INTEGER NOT NULL,
    "duracaoMs" INTEGER,
    "codecVideo" TEXT,
    "codecAudio" TEXT,
    "moovNoInicio" BOOLEAN,
    "hashSha256" TEXT NOT NULL,
    "criadoEm" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Midia_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Postagem" (
    "id" UUID NOT NULL,
    "contaId" UUID NOT NULL,
    "formato" "FormatoPostagem" NOT NULL,
    "status" "StatusPostagem" NOT NULL DEFAULT 'RASCUNHO',
    "legenda" TEXT,
    "publicarEm" TIMESTAMPTZ(3),
    "apareceNoFeed" BOOLEAN,
    "capaOffsetMs" INTEGER,
    "capaMidiaId" UUID,
    "geradoPorIA" BOOLEAN NOT NULL DEFAULT false,
    "versao" INTEGER NOT NULL DEFAULT 1,
    "tentativas" INTEGER NOT NULL DEFAULT 0,
    "ultimoErroCodigo" TEXT,
    "ultimoErroMensagem" TEXT,
    "criadoPorId" UUID NOT NULL,
    "agendadoPorId" UUID,
    "atualizadoPorId" UUID,
    "criadoEm" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizadoEm" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "Postagem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PostagemMidia" (
    "id" UUID NOT NULL,
    "postagemId" UUID NOT NULL,
    "midiaId" UUID NOT NULL,
    "ordem" INTEGER NOT NULL,
    "textoAlternativo" TEXT,

    CONSTRAINT "PostagemMidia_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Marcacao" (
    "id" UUID NOT NULL,
    "postagemMidiaId" UUID NOT NULL,
    "username" TEXT NOT NULL,
    "x" DOUBLE PRECISION,
    "y" DOUBLE PRECISION,

    CONSTRAINT "Marcacao_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Colaborador" (
    "id" UUID NOT NULL,
    "postagemId" UUID NOT NULL,
    "username" TEXT NOT NULL,

    CONSTRAINT "Colaborador_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ContainerPublicacao" (
    "id" UUID NOT NULL,
    "postagemId" UUID NOT NULL,
    "igContainerId" TEXT NOT NULL,
    "papel" "PapelContainer" NOT NULL,
    "statusCode" "StatusContainer",
    "criadoEm" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiraEm" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "ContainerPublicacao_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Publicacao" (
    "id" UUID NOT NULL,
    "postagemId" UUID NOT NULL,
    "idExterno" TEXT NOT NULL,
    "permalink" TEXT,
    "publicadoEm" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "Publicacao_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MetricaPostagem" (
    "id" UUID NOT NULL,
    "publicacaoId" UUID NOT NULL,
    "momento" "MomentoMetrica" NOT NULL,
    "coletadoEm" TIMESTAMPTZ(3) NOT NULL,
    "valores" JSONB NOT NULL,

    CONSTRAINT "MetricaPostagem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Aprovacao" (
    "id" UUID NOT NULL,
    "postagemId" UUID NOT NULL,
    "usuarioId" UUID NOT NULL,
    "acao" "AcaoAprovacao" NOT NULL,
    "motivo" TEXT,
    "criadoEm" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Aprovacao_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ComentarioInterno" (
    "id" UUID NOT NULL,
    "postagemId" UUID NOT NULL,
    "usuarioId" UUID NOT NULL,
    "texto" TEXT NOT NULL,
    "criadoEm" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ComentarioInterno_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EventoPublicacao" (
    "id" UUID NOT NULL,
    "postagemId" UUID NOT NULL,
    "etapa" "EtapaPublicacao" NOT NULL,
    "resultado" "ResultadoEtapa" NOT NULL,
    "duracaoMs" INTEGER,
    "respostaMeta" JSONB,
    "criadoEm" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EventoPublicacao_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EventoToken" (
    "id" UUID NOT NULL,
    "contaId" UUID NOT NULL,
    "acao" "AcaoToken" NOT NULL,
    "resultado" "ResultadoEtapa" NOT NULL,
    "criadoEm" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EventoToken_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MetricaConta" (
    "id" UUID NOT NULL,
    "contaId" UUID NOT NULL,
    "dia" DATE NOT NULL,
    "valores" JSONB NOT NULL,
    "coletadoEm" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "MetricaConta_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Notificacao" (
    "id" UUID NOT NULL,
    "tipo" "TipoNotificacao" NOT NULL,
    "alvoTipo" TEXT NOT NULL,
    "alvoId" TEXT NOT NULL,
    "criadaEm" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Notificacao_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "NotificacaoEntrega" (
    "id" UUID NOT NULL,
    "notificacaoId" UUID NOT NULL,
    "usuarioId" UUID NOT NULL,
    "lidaEm" TIMESTAMPTZ(3),
    "pushEnviadoEm" TIMESTAMPTZ(3),

    CONSTRAINT "NotificacaoEntrega_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InscricaoPush" (
    "id" UUID NOT NULL,
    "usuarioId" UUID NOT NULL,
    "endpoint" TEXT NOT NULL,
    "chaveP256dh" TEXT NOT NULL,
    "chaveAuth" TEXT NOT NULL,
    "aparelho" TEXT,
    "ultimoSucessoEm" TIMESTAMPTZ(3),
    "falhasSeguidas" INTEGER NOT NULL DEFAULT 0,
    "criadaEm" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "InscricaoPush_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PreferenciaNotificacao" (
    "id" UUID NOT NULL,
    "usuarioId" UUID NOT NULL,
    "tipo" "TipoNotificacao" NOT NULL,
    "push" BOOLEAN NOT NULL,

    CONSTRAINT "PreferenciaNotificacao_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Usuario_email_key" ON "Usuario"("email");

-- CreateIndex
CREATE INDEX "Usuario_superAdmin_desativadoEm_idx" ON "Usuario"("superAdmin", "desativadoEm");

-- CreateIndex
CREATE UNIQUE INDEX "PermissaoUsuario_usuarioId_permissao_key" ON "PermissaoUsuario"("usuarioId", "permissao");

-- CreateIndex
CREATE UNIQUE INDEX "Sessao_tokenHash_key" ON "Sessao"("tokenHash");

-- CreateIndex
CREATE INDEX "Sessao_usuarioId_revogadaEm_idx" ON "Sessao"("usuarioId", "revogadaEm");

-- CreateIndex
CREATE INDEX "Sessao_criadoEm_idx" ON "Sessao"("criadoEm");

-- CreateIndex
CREATE UNIQUE INDEX "DesafioLogin_tokenHash_key" ON "DesafioLogin"("tokenHash");

-- CreateIndex
CREATE INDEX "DesafioLogin_criadoEm_idx" ON "DesafioLogin"("criadoEm");

-- CreateIndex
CREATE UNIQUE INDEX "CodigoRecuperacao_codigoHash_key" ON "CodigoRecuperacao"("codigoHash");

-- CreateIndex
CREATE UNIQUE INDEX "LinkAcesso_tokenHash_key" ON "LinkAcesso"("tokenHash");

-- CreateIndex
CREATE INDEX "LinkAcesso_criadoEm_idx" ON "LinkAcesso"("criadoEm");

-- CreateIndex
CREATE INDEX "TentativaAcesso_email_criadoEm_idx" ON "TentativaAcesso"("email", "criadoEm");

-- CreateIndex
CREATE INDEX "TentativaAcesso_ip_criadoEm_idx" ON "TentativaAcesso"("ip", "criadoEm");

-- CreateIndex
CREATE INDEX "TentativaAcesso_criadoEm_idx" ON "TentativaAcesso"("criadoEm");

-- CreateIndex
CREATE INDEX "BloqueioAcesso_tipo_chave_ate_idx" ON "BloqueioAcesso"("tipo", "chave", "ate");

-- CreateIndex
CREATE INDEX "BloqueioAcesso_criadoEm_idx" ON "BloqueioAcesso"("criadoEm");

-- CreateIndex
CREATE INDEX "EventoAuditoria_criadoEm_idx" ON "EventoAuditoria"("criadoEm");

-- CreateIndex
CREATE INDEX "EventoAuditoria_alvoTipo_alvoId_idx" ON "EventoAuditoria"("alvoTipo", "alvoId");

-- CreateIndex
CREATE INDEX "Conta_tokenExpiraEm_idx" ON "Conta"("tokenExpiraEm");

-- CreateIndex
CREATE UNIQUE INDEX "Conta_rede_idExterno_key" ON "Conta"("rede", "idExterno");

-- CreateIndex
CREATE UNIQUE INDEX "Midia_chaveObjeto_key" ON "Midia"("chaveObjeto");

-- CreateIndex
CREATE INDEX "Postagem_status_publicarEm_idx" ON "Postagem"("status", "publicarEm");

-- CreateIndex
CREATE INDEX "Postagem_contaId_publicarEm_idx" ON "Postagem"("contaId", "publicarEm");

-- CreateIndex
CREATE UNIQUE INDEX "PostagemMidia_postagemId_ordem_key" ON "PostagemMidia"("postagemId", "ordem");

-- CreateIndex
CREATE INDEX "ContainerPublicacao_postagemId_expiraEm_idx" ON "ContainerPublicacao"("postagemId", "expiraEm");

-- CreateIndex
CREATE UNIQUE INDEX "Publicacao_postagemId_key" ON "Publicacao"("postagemId");

-- CreateIndex
CREATE UNIQUE INDEX "Publicacao_idExterno_key" ON "Publicacao"("idExterno");

-- CreateIndex
CREATE INDEX "MetricaPostagem_publicacaoId_momento_idx" ON "MetricaPostagem"("publicacaoId", "momento");

-- CreateIndex
CREATE INDEX "EventoPublicacao_postagemId_criadoEm_idx" ON "EventoPublicacao"("postagemId", "criadoEm");

-- CreateIndex
CREATE UNIQUE INDEX "MetricaConta_contaId_dia_key" ON "MetricaConta"("contaId", "dia");

-- CreateIndex
CREATE INDEX "NotificacaoEntrega_usuarioId_lidaEm_idx" ON "NotificacaoEntrega"("usuarioId", "lidaEm");

-- CreateIndex
CREATE UNIQUE INDEX "NotificacaoEntrega_notificacaoId_usuarioId_key" ON "NotificacaoEntrega"("notificacaoId", "usuarioId");

-- CreateIndex
CREATE UNIQUE INDEX "InscricaoPush_endpoint_key" ON "InscricaoPush"("endpoint");

-- CreateIndex
CREATE INDEX "InscricaoPush_usuarioId_idx" ON "InscricaoPush"("usuarioId");

-- CreateIndex
CREATE UNIQUE INDEX "PreferenciaNotificacao_usuarioId_tipo_key" ON "PreferenciaNotificacao"("usuarioId", "tipo");

-- AddForeignKey
ALTER TABLE "Usuario" ADD CONSTRAINT "Usuario_desativadoPorId_fkey" FOREIGN KEY ("desativadoPorId") REFERENCES "Usuario"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PermissaoUsuario" ADD CONSTRAINT "PermissaoUsuario_usuarioId_fkey" FOREIGN KEY ("usuarioId") REFERENCES "Usuario"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PermissaoUsuario" ADD CONSTRAINT "PermissaoUsuario_concedidaPorId_fkey" FOREIGN KEY ("concedidaPorId") REFERENCES "Usuario"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Sessao" ADD CONSTRAINT "Sessao_usuarioId_fkey" FOREIGN KEY ("usuarioId") REFERENCES "Usuario"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DesafioLogin" ADD CONSTRAINT "DesafioLogin_usuarioId_fkey" FOREIGN KEY ("usuarioId") REFERENCES "Usuario"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CodigoRecuperacao" ADD CONSTRAINT "CodigoRecuperacao_usuarioId_fkey" FOREIGN KEY ("usuarioId") REFERENCES "Usuario"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LinkAcesso" ADD CONSTRAINT "LinkAcesso_usuarioId_fkey" FOREIGN KEY ("usuarioId") REFERENCES "Usuario"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BloqueioAcesso" ADD CONSTRAINT "BloqueioAcesso_liberadoPorId_fkey" FOREIGN KEY ("liberadoPorId") REFERENCES "Usuario"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EventoAuditoria" ADD CONSTRAINT "EventoAuditoria_autorId_fkey" FOREIGN KEY ("autorId") REFERENCES "Usuario"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Postagem" ADD CONSTRAINT "Postagem_contaId_fkey" FOREIGN KEY ("contaId") REFERENCES "Conta"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Postagem" ADD CONSTRAINT "Postagem_capaMidiaId_fkey" FOREIGN KEY ("capaMidiaId") REFERENCES "Midia"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Postagem" ADD CONSTRAINT "Postagem_criadoPorId_fkey" FOREIGN KEY ("criadoPorId") REFERENCES "Usuario"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Postagem" ADD CONSTRAINT "Postagem_agendadoPorId_fkey" FOREIGN KEY ("agendadoPorId") REFERENCES "Usuario"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Postagem" ADD CONSTRAINT "Postagem_atualizadoPorId_fkey" FOREIGN KEY ("atualizadoPorId") REFERENCES "Usuario"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PostagemMidia" ADD CONSTRAINT "PostagemMidia_postagemId_fkey" FOREIGN KEY ("postagemId") REFERENCES "Postagem"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PostagemMidia" ADD CONSTRAINT "PostagemMidia_midiaId_fkey" FOREIGN KEY ("midiaId") REFERENCES "Midia"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Marcacao" ADD CONSTRAINT "Marcacao_postagemMidiaId_fkey" FOREIGN KEY ("postagemMidiaId") REFERENCES "PostagemMidia"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Colaborador" ADD CONSTRAINT "Colaborador_postagemId_fkey" FOREIGN KEY ("postagemId") REFERENCES "Postagem"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ContainerPublicacao" ADD CONSTRAINT "ContainerPublicacao_postagemId_fkey" FOREIGN KEY ("postagemId") REFERENCES "Postagem"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Publicacao" ADD CONSTRAINT "Publicacao_postagemId_fkey" FOREIGN KEY ("postagemId") REFERENCES "Postagem"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MetricaPostagem" ADD CONSTRAINT "MetricaPostagem_publicacaoId_fkey" FOREIGN KEY ("publicacaoId") REFERENCES "Publicacao"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Aprovacao" ADD CONSTRAINT "Aprovacao_postagemId_fkey" FOREIGN KEY ("postagemId") REFERENCES "Postagem"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Aprovacao" ADD CONSTRAINT "Aprovacao_usuarioId_fkey" FOREIGN KEY ("usuarioId") REFERENCES "Usuario"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ComentarioInterno" ADD CONSTRAINT "ComentarioInterno_postagemId_fkey" FOREIGN KEY ("postagemId") REFERENCES "Postagem"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ComentarioInterno" ADD CONSTRAINT "ComentarioInterno_usuarioId_fkey" FOREIGN KEY ("usuarioId") REFERENCES "Usuario"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EventoPublicacao" ADD CONSTRAINT "EventoPublicacao_postagemId_fkey" FOREIGN KEY ("postagemId") REFERENCES "Postagem"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EventoToken" ADD CONSTRAINT "EventoToken_contaId_fkey" FOREIGN KEY ("contaId") REFERENCES "Conta"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MetricaConta" ADD CONSTRAINT "MetricaConta_contaId_fkey" FOREIGN KEY ("contaId") REFERENCES "Conta"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NotificacaoEntrega" ADD CONSTRAINT "NotificacaoEntrega_notificacaoId_fkey" FOREIGN KEY ("notificacaoId") REFERENCES "Notificacao"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NotificacaoEntrega" ADD CONSTRAINT "NotificacaoEntrega_usuarioId_fkey" FOREIGN KEY ("usuarioId") REFERENCES "Usuario"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InscricaoPush" ADD CONSTRAINT "InscricaoPush_usuarioId_fkey" FOREIGN KEY ("usuarioId") REFERENCES "Usuario"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PreferenciaNotificacao" ADD CONSTRAINT "PreferenciaNotificacao_usuarioId_fkey" FOREIGN KEY ("usuarioId") REFERENCES "Usuario"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
