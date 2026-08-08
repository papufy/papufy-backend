-- Validade de anúncios (15 dias) + tabela de renovação PIX

ALTER TABLE "Listing"
  ADD COLUMN IF NOT EXISTS "expiresAt" TIMESTAMP(3);

ALTER TABLE "Listing"
  ADD COLUMN IF NOT EXISTS "expiredByTtl" BOOLEAN NOT NULL DEFAULT false;

UPDATE "Listing"
SET "expiresAt" = "createdAt" + interval '15 days'
WHERE "expiresAt" IS NULL;

CREATE INDEX IF NOT EXISTS "Listing_expiresAt_idx"
  ON "Listing" ("expiresAt");

CREATE INDEX IF NOT EXISTS "Listing_status_expiresAt_idx"
  ON "Listing" ("status", "expiresAt");

CREATE TABLE IF NOT EXISTS "ListingRenewal" (
  "id" TEXT PRIMARY KEY,
  "listingId" TEXT NOT NULL REFERENCES "Listing"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  "userId" TEXT NOT NULL REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  "pagarmeOrderId" TEXT,
  "pagarmeChargeId" TEXT,
  "paymentProvider" TEXT,
  "amountGross" DOUBLE PRECISION NOT NULL,
  "billingType" "BillingType" NOT NULL DEFAULT 'PIX',
  "status" "TransactionStatus" NOT NULL DEFAULT 'PENDING',
  "pixQrCodeImage" TEXT,
  "pixCopyPaste" TEXT,
  "paidAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS "ListingRenewal_listingId_idx"
  ON "ListingRenewal" ("listingId");

CREATE INDEX IF NOT EXISTS "ListingRenewal_userId_idx"
  ON "ListingRenewal" ("userId");

CREATE INDEX IF NOT EXISTS "ListingRenewal_pagarmeChargeId_idx"
  ON "ListingRenewal" ("pagarmeChargeId");
