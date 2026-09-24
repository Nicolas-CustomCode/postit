-- O push da parte H (ADR 0017, acréscimo de 24/09/2026): a inscrição fica presa à
-- sessão que a criou, e o Perfil pode pedir um push de teste.

-- A tabela nunca foi usada até aqui; o que houver não tem sessão para apontar.
DELETE FROM "InscricaoPush";

ALTER TABLE "InscricaoPush" ADD COLUMN "sessaoId" UUID NOT NULL;
ALTER TABLE "InscricaoPush" ADD COLUMN "testePendenteEm" TIMESTAMPTZ(3);

ALTER TABLE "InscricaoPush" ADD CONSTRAINT "InscricaoPush_sessaoId_fkey"
  FOREIGN KEY ("sessaoId") REFERENCES "Sessao"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
