-- A mídia que nasceu do ajuste de outra — recortada ou enquadrada (RF-B03)
-- aponta para a que a originou.
--
-- ⚠️ É **fato de origem**, não intenção de uso: a regra do docs/07 continua
-- valendo. A coluna guarda de qual mídia esta veio, que é da mesma família de
-- `bytes` e `hashSha256`, e nunca para que formato ela foi feita — isso seria
-- intenção, e é a tentação que vai aparecer quando alguém quiser mostrar
-- "ajustada para o Feed" na tela.
--
-- Nula em tudo que já existe: nada no acervo veio de ajuste antes desta data.
ALTER TABLE "Midia" ADD COLUMN "derivadaDeId" UUID;

-- SET NULL, e não RESTRICT: a derivada pode estar anexada a uma postagem
-- agendada, e apagar a original não pode impedir a publicação. A consequência
-- aceita é que, sem original, a derivada volta a aparecer no acervo — o que é
-- verdade: ela deixou de ser variante de alguma coisa.
ALTER TABLE "Midia"
  ADD CONSTRAINT "Midia_derivadaDeId_fkey"
  FOREIGN KEY ("derivadaDeId") REFERENCES "Midia"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

-- Serve às duas leituras: o filtro do acervo (derivadaDeId IS NULL) e o próprio
-- SET NULL, que procura as filhas ao apagar a mãe.
CREATE INDEX "Midia_derivadaDeId_idx" ON "Midia"("derivadaDeId");
