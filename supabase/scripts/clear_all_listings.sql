-- Remove todos os anúncios (Listing) e dados relacionados.
-- Idempotente: ignora tabelas que ainda não existem no projeto.
-- SQL Editor: https://supabase.com/dashboard/project/lyxdjprsfstxqakudhjd/sql/new

BEGIN;

DO $block$
BEGIN
  IF to_regclass('public."Review"') IS NOT NULL
     AND to_regclass('public."Transaction"') IS NOT NULL THEN
    DELETE FROM "Review"
    WHERE "transactionId" IN (SELECT "id" FROM "Transaction");
  END IF;

  IF to_regclass('public."SupportTicket"') IS NOT NULL
     AND to_regclass('public."Transaction"') IS NOT NULL THEN
    DELETE FROM "SupportTicket"
    WHERE "transactionId" IN (SELECT "id" FROM "Transaction");
  END IF;

  IF to_regclass('public."Transaction"') IS NOT NULL THEN
    DELETE FROM "Transaction";
  END IF;

  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'Conversation'
      AND column_name = 'listingId'
  ) THEN
    DELETE FROM "Message"
    WHERE "conversationId" IN (
      SELECT "id" FROM "Conversation" WHERE "listingId" IS NOT NULL
    );
    DELETE FROM "Conversation" WHERE "listingId" IS NOT NULL;
  END IF;
END
$block$;

DELETE FROM "ListingImage";
DELETE FROM "Listing";

COMMIT;

SELECT
  (SELECT COUNT(*) FROM "Listing") AS listings,
  (SELECT COUNT(*) FROM "ListingImage") AS images;
