/*
  Warnings:
  - The values [FEED_IMAGEM,FEED_VIDEO,CARROSSEL] on the enum `FormatoPostagem`
    will be removed. If these variants are still used in the database, this will
    fail.
*/

-- AlterEnum
--
-- Postgres não remove valor de enum: cria-se um tipo novo, converte-se a coluna
-- e o tipo antigo cai. É o primeiro caso do projeto — as outras migrations de
-- enum só acrescentam valor (ALTER TYPE ... ADD VALUE), que o Prisma gera
-- sozinho. Esta foi escrita à mão porque o USING gerado é um cast cego
-- ("formato"::text::"FormatoPostagem_new") que estoura na primeira linha
-- FEED_IMAGEM e faz o migrate dev oferecer resetar o banco.
--
-- O mapeamento (ADR 0024): FEED_IMAGEM e CARROSSEL viram FEED, porque carrossel
-- deixou de ser formato e virou quantidade de PostagemMidia. FEED_VIDEO vira
-- REELS — a própria Meta converte vídeo único de feed em Reels (docs/08, V-7).
--
-- O CASE precisa cobrir todos os valores antigos: a coluna é NOT NULL e um ramo
-- faltando devolveria NULL.
BEGIN;
CREATE TYPE "FormatoPostagem_new" AS ENUM ('FEED', 'REELS', 'STORIES');

ALTER TABLE "Postagem" ALTER COLUMN "formato" TYPE "FormatoPostagem_new"
  USING (
    CASE "formato"::text
      WHEN 'FEED_IMAGEM' THEN 'FEED'
      WHEN 'CARROSSEL'   THEN 'FEED'
      WHEN 'FEED_VIDEO'  THEN 'REELS'
      WHEN 'REELS'       THEN 'REELS'
      WHEN 'STORIES'     THEN 'STORIES'
    END
  )::"FormatoPostagem_new";

ALTER TYPE "FormatoPostagem" RENAME TO "FormatoPostagem_old";
ALTER TYPE "FormatoPostagem_new" RENAME TO "FormatoPostagem";
DROP TYPE "FormatoPostagem_old";
COMMIT;
