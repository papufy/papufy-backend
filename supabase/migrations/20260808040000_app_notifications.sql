-- Notificações in-app (ex.: aviso de expiração de anúncio)

CREATE TABLE IF NOT EXISTS "AppNotification" (
  "id" TEXT PRIMARY KEY,
  "userId" TEXT NOT NULL REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  "listingId" TEXT REFERENCES "Listing"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  "type" TEXT NOT NULL,
  "title" TEXT NOT NULL,
  "body" TEXT NOT NULL,
  "href" TEXT,
  "refExpiresAt" TIMESTAMP(3),
  "readAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS "AppNotification_userId_createdAt_idx"
  ON "AppNotification" ("userId", "createdAt" DESC);

CREATE INDEX IF NOT EXISTS "AppNotification_userId_readAt_idx"
  ON "AppNotification" ("userId", "readAt");

CREATE UNIQUE INDEX IF NOT EXISTS "AppNotification_dedup_idx"
  ON "AppNotification" ("listingId", "type", "refExpiresAt")
  WHERE "listingId" IS NOT NULL AND "refExpiresAt" IS NOT NULL;
