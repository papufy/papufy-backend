-- Anúncio arquivado após avaliação (oculto da vitrine e de "meus anúncios")

ALTER TABLE "Listing"
  ADD COLUMN IF NOT EXISTS "archivedAt" TIMESTAMP(3);

CREATE INDEX IF NOT EXISTS "Listing_archivedAt_idx" ON "Listing"("archivedAt");
