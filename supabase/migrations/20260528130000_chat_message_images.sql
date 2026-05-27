-- Mensagens de imagem no chat
BEGIN;

ALTER TABLE "Message"
  ADD COLUMN IF NOT EXISTS "imageUrl" TEXT;

COMMIT;
