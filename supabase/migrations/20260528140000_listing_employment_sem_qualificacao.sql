-- Tipo EMPLOYMENT (vaga de emprego) + flag sem qualificação obrigatória
BEGIN;

ALTER TYPE "ListingType" ADD VALUE IF NOT EXISTS 'EMPLOYMENT';

ALTER TABLE "Listing"
  ADD COLUMN IF NOT EXISTS "semQualificacao" BOOLEAN NOT NULL DEFAULT false;

COMMIT;
