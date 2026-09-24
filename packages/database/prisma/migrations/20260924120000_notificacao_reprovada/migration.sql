-- O aviso "reprovada", para o autor e para quem enviou para revisão (RF-E03, RF-J03).
-- O sino da parte G da Fase 1d.

-- ADD VALUE dentro da transação da migração é aceito a partir do PG 12; o valor
-- novo só não pode ser usado nessa mesma transação, e esta migração não o usa.
ALTER TYPE "TipoNotificacao" ADD VALUE 'POSTAGEM_REPROVADA';
