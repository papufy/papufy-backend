-- Faixa de orçamento (margem de negociação) e diferenciais do serviço
ALTER TABLE IF EXISTS "Job"
ADD COLUMN IF NOT EXISTS "precoMin" DOUBLE PRECISION,
ADD COLUMN IF NOT EXISTS "precoMax" DOUBLE PRECISION,
ADD COLUMN IF NOT EXISTS "diferenciais" TEXT;

ALTER TABLE IF EXISTS "Listing"
ADD COLUMN IF NOT EXISTS "precoMin" DOUBLE PRECISION,
ADD COLUMN IF NOT EXISTS "precoMax" DOUBLE PRECISION,
ADD COLUMN IF NOT EXISTS "diferenciais" TEXT;

COMMENT ON COLUMN "Job"."precoMin" IS 'Orçamento mínimo aceito (faixa de negociação)';
COMMENT ON COLUMN "Job"."precoMax" IS 'Orçamento máximo aceito (faixa de negociação)';
COMMENT ON COLUMN "Job"."diferenciais" IS 'O que diferencia o serviço / o que deve estar incluso';
COMMENT ON COLUMN "Listing"."precoMin" IS 'Preço mínimo da faixa de negociação';
COMMENT ON COLUMN "Listing"."precoMax" IS 'Preço máximo da faixa de negociação';
COMMENT ON COLUMN "Listing"."diferenciais" IS 'Diferenciais do profissional ou do serviço';
