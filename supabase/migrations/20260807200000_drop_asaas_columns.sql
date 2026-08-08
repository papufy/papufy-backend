-- Remove colunas Asaas (PSP descontinuado; Papufy usa so Pagar.me).
-- Um DROP por statement.

DROP INDEX IF EXISTS "Transaction_asaasPaymentId_key";

ALTER TABLE IF EXISTS "Transaction"
DROP COLUMN IF EXISTS "asaasPaymentId";

ALTER TABLE IF EXISTS "User"
DROP COLUMN IF EXISTS "asaasCustomerId";

ALTER TABLE IF EXISTS "User"
DROP COLUMN IF EXISTS "asaasWalletId";

ALTER TABLE IF EXISTS "User"
DROP COLUMN IF EXISTS "asaasAccountId";

ALTER TABLE IF EXISTS "User"
DROP COLUMN IF EXISTS "asaasSubaccountApiKey";
