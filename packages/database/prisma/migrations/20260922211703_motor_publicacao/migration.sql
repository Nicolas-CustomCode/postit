-- O motor de publicação (Fase 1d; docs/09).

-- As decisões do motor que não são chamada à Meta. ADD VALUE dentro da
-- transação da migração é aceito a partir do PG 12; o valor novo só não pode ser
-- usado nessa mesma transação, e esta migração não o usa.
ALTER TYPE "EtapaPublicacao" ADD VALUE 'DESPACHAR';
ALTER TYPE "EtapaPublicacao" ADD VALUE 'RECONCILIAR';
ALTER TYPE "EtapaPublicacao" ADD VALUE 'DESISTIR';

-- A conta cuja conexão a Meta recusou (docs/09, "sinaliza a conta"). Nula em tudo
-- que existe: nenhuma conta foi recusada antes de haver quem publicasse.
ALTER TABLE "Conta" ADD COLUMN "acessoPerdidoEm" TIMESTAMPTZ(3);

-- O arrendamento da execução (I-6). O pg-boss reinicia uma tarefa vencida com a
-- anterior ainda rodando; só quem segura o arrendamento fala com a Meta.
ALTER TABLE "Postagem" ADD COLUMN "execucaoId" UUID;
ALTER TABLE "Postagem" ADD COLUMN "execucaoExpiraEm" TIMESTAMPTZ(3);

-- NOT NULL sem valor padrão: a tabela está vazia, porque nada criou container
-- antes desta migração. Conferido nos bancos de desenvolvimento e de teste.
ALTER TABLE "ContainerPublicacao" ADD COLUMN "versaoPostagem" INTEGER NOT NULL;
ALTER TABLE "ContainerPublicacao" ADD COLUMN "ordem" INTEGER;
ALTER TABLE "ContainerPublicacao" ADD COLUMN "publicarPedidoEm" TIMESTAMPTZ(3);

-- Publicação confirmada pelo estado do container, sem o id da mídia (V-28). O
-- índice único continua: nulos não colidem entre si.
ALTER TABLE "Publicacao" ALTER COLUMN "idExterno" DROP NOT NULL;
