-- Chave de API da subconta Asaas (retornada uma única vez na criação da subconta)
BEGIN;

ALTER TABLE "User"
  ADD COLUMN IF NOT EXISTS "asaasSubaccountApiKey" TEXT,
  ADD COLUMN IF NOT EXISTS "asaasAccountId" TEXT;

COMMIT;
