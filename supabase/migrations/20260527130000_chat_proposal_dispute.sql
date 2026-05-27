ALTER TYPE "TransactionStatus" ADD VALUE IF NOT EXISTS 'IN_DISPUTE';

ALTER TABLE "Message"
ADD COLUMN IF NOT EXISTS "type" TEXT NOT NULL DEFAULT 'TEXT',
ADD COLUMN IF NOT EXISTS "proposalValue" DOUBLE PRECISION,
ADD COLUMN IF NOT EXISTS "transactionId" TEXT;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'Message_transactionId_fkey'
  ) THEN
    ALTER TABLE "Message"
      ADD CONSTRAINT "Message_transactionId_fkey"
      FOREIGN KEY ("transactionId")
      REFERENCES "Transaction"("id")
      ON DELETE SET NULL
      ON UPDATE CASCADE;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS "Message_transactionId_idx"
  ON "Message"("transactionId");

CREATE TYPE IF NOT EXISTS "SupportTicketStatus" AS ENUM ('ABERTO', 'EM_ANALISE', 'RESOLVIDO');

CREATE TABLE IF NOT EXISTS "SupportTicket" (
  "id" TEXT NOT NULL,
  "transactionId" TEXT,
  "conversationId" TEXT,
  "reporterId" TEXT NOT NULL,
  "descricao" TEXT NOT NULL,
  "comprovanteUrl" TEXT,
  "status" "SupportTicketStatus" NOT NULL DEFAULT 'ABERTO',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "SupportTicket_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "SupportTicket_transactionId_idx"
  ON "SupportTicket"("transactionId");
CREATE INDEX IF NOT EXISTS "SupportTicket_reporterId_idx"
  ON "SupportTicket"("reporterId");
CREATE INDEX IF NOT EXISTS "SupportTicket_status_idx"
  ON "SupportTicket"("status");

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'SupportTicket_transactionId_fkey'
  ) THEN
    ALTER TABLE "SupportTicket"
      ADD CONSTRAINT "SupportTicket_transactionId_fkey"
      FOREIGN KEY ("transactionId")
      REFERENCES "Transaction"("id")
      ON DELETE SET NULL
      ON UPDATE CASCADE;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'SupportTicket_reporterId_fkey'
  ) THEN
    ALTER TABLE "SupportTicket"
      ADD CONSTRAINT "SupportTicket_reporterId_fkey"
      FOREIGN KEY ("reporterId")
      REFERENCES "User"("id")
      ON DELETE CASCADE
      ON UPDATE CASCADE;
  END IF;
END $$;
