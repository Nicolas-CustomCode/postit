-- A postagem em duas etapas (ADR 0026): Aprovacao passa a registrar toda decisão
-- humana de estado, não só as da revisão.

-- ADD VALUE dentro da transação da migração é aceito a partir do PG 12; os valores
-- novos só não podem ser usados nessa mesma transação, e esta migração não os usa.
ALTER TYPE "AcaoAprovacao" ADD VALUE 'VOLTOU_RASCUNHO';
ALTER TYPE "AcaoAprovacao" ADD VALUE 'AGENDOU';
ALTER TYPE "AcaoAprovacao" ADD VALUE 'DESAGENDOU';
ALTER TYPE "AcaoAprovacao" ADD VALUE 'CANCELOU';

-- O horário marcado pela decisão que agenda. Nulo em tudo que existe: até aqui,
-- agendar não deixava linha.
ALTER TABLE "Aprovacao" ADD COLUMN "agendadaPara" TIMESTAMPTZ(3);

-- A linha do tempo da Revisão lê as duas por postagem, em ordem.
CREATE INDEX "Aprovacao_postagemId_criadoEm_idx" ON "Aprovacao"("postagemId", "criadoEm");
CREATE INDEX "ComentarioInterno_postagemId_criadoEm_idx" ON "ComentarioInterno"("postagemId", "criadoEm");
