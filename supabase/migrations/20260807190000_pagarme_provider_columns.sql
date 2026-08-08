-- Colunas Pagar.me para customer/recipient e cobranças.
-- Um ADD por statement (compatível com o runner do ensureSchema).

ALTER TABLE IF EXISTS "User"
ADD COLUMN IF NOT EXISTS "pagarmeCustomerId" TEXT;

ALTER TABLE IF EXISTS "User"
ADD COLUMN IF NOT EXISTS "pagarmeRecipientId" TEXT;

ALTER TABLE IF EXISTS "User"
ADD COLUMN IF NOT EXISTS "paymentProvider" TEXT;

ALTER TABLE IF EXISTS "Transaction"
ADD COLUMN IF NOT EXISTS "pagarmeOrderId" TEXT;

ALTER TABLE IF EXISTS "Transaction"
ADD COLUMN IF NOT EXISTS "pagarmeChargeId" TEXT;

ALTER TABLE IF EXISTS "Transaction"
ADD COLUMN IF NOT EXISTS "paymentProvider" TEXT;

CREATE INDEX IF NOT EXISTS "Transaction_pagarmeChargeId_idx"
  ON "Transaction" ("pagarmeChargeId");

CREATE INDEX IF NOT EXISTS "User_pagarmeRecipientId_idx"
  ON "User" ("pagarmeRecipientId");
