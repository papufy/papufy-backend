-- Asaas split integration + financial onboarding + listing checkout
-- Safe to run on top of 20260322000000_papufy_initial_schema.sql
-- Idempotent: pode rodar de novo se falhar no meio ou objetos já existirem.

BEGIN;

-- 1) Extend enums
ALTER TYPE "ListingStatus" ADD VALUE IF NOT EXISTS 'IN_PROGRESS';

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'TransactionStatus') THEN
    CREATE TYPE "TransactionStatus" AS ENUM ('PENDING', 'PAID', 'FAILED', 'CANCELED');
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'BillingType') THEN
    CREATE TYPE "BillingType" AS ENUM ('PIX', 'CREDIT_CARD');
  END IF;
END $$;

-- 2) User financial fields
ALTER TABLE "User"
  ADD COLUMN IF NOT EXISTS "cpfCnpj" TEXT,
  ADD COLUMN IF NOT EXISTS "asaasCustomerId" TEXT,
  ADD COLUMN IF NOT EXISTS "asaasWalletId" TEXT;

-- 3) Conversation supports listing context
ALTER TABLE "Conversation"
  ALTER COLUMN "jobId" DROP NOT NULL;

ALTER TABLE "Conversation"
  ADD COLUMN IF NOT EXISTS "listingId" TEXT;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'Conversation_listingId_fkey'
  ) THEN
    ALTER TABLE "Conversation"
      ADD CONSTRAINT "Conversation_listingId_fkey"
      FOREIGN KEY ("listingId") REFERENCES "Listing"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS "Conversation_listingId_idx"
  ON "Conversation"("listingId");

CREATE UNIQUE INDEX IF NOT EXISTS "Conversation_listingId_contractorId_providerId_key"
  ON "Conversation"("listingId", "contractorId", "providerId")
  WHERE "listingId" IS NOT NULL;

-- 4) Financial transaction table
CREATE TABLE IF NOT EXISTS "Transaction" (
  "id" TEXT NOT NULL,
  "listingId" TEXT NOT NULL,
  "contractorId" TEXT NOT NULL,
  "professionalId" TEXT NOT NULL,
  "asaasPaymentId" TEXT,
  "amountGross" DOUBLE PRECISION NOT NULL,
  "platformFee" DOUBLE PRECISION NOT NULL,
  "professionalNet" DOUBLE PRECISION NOT NULL,
  "billingType" "BillingType" NOT NULL,
  "status" "TransactionStatus" NOT NULL DEFAULT 'PENDING',
  "pixQrCodeImage" TEXT,
  "pixCopyPaste" TEXT,
  "invoiceUrl" TEXT,
  "paymentLink" TEXT,
  "dueDate" TIMESTAMP(3),
  "paidAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "Transaction_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "Transaction_asaasPaymentId_key"
  ON "Transaction"("asaasPaymentId");

CREATE INDEX IF NOT EXISTS "Transaction_listingId_idx"
  ON "Transaction"("listingId");

CREATE INDEX IF NOT EXISTS "Transaction_contractorId_idx"
  ON "Transaction"("contractorId");

CREATE INDEX IF NOT EXISTS "Transaction_professionalId_idx"
  ON "Transaction"("professionalId");

CREATE INDEX IF NOT EXISTS "Transaction_status_idx"
  ON "Transaction"("status");

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'Transaction_listingId_fkey'
  ) THEN
    ALTER TABLE "Transaction"
      ADD CONSTRAINT "Transaction_listingId_fkey"
      FOREIGN KEY ("listingId") REFERENCES "Listing"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'Transaction_contractorId_fkey'
  ) THEN
    ALTER TABLE "Transaction"
      ADD CONSTRAINT "Transaction_contractorId_fkey"
      FOREIGN KEY ("contractorId") REFERENCES "User"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'Transaction_professionalId_fkey'
  ) THEN
    ALTER TABLE "Transaction"
      ADD CONSTRAINT "Transaction_professionalId_fkey"
      FOREIGN KEY ("professionalId") REFERENCES "User"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

COMMIT;
