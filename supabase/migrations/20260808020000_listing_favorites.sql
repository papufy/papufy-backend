-- Favoritos de anúncios (não usar localStorage no cliente).

CREATE TABLE IF NOT EXISTS "ListingFavorite" (
  "id" TEXT PRIMARY KEY,
  "userId" TEXT NOT NULL,
  "listingId" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ListingFavorite_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "ListingFavorite_listingId_fkey"
    FOREIGN KEY ("listingId") REFERENCES "Listing"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS "ListingFavorite_userId_listingId_key"
  ON "ListingFavorite" ("userId", "listingId");

CREATE INDEX IF NOT EXISTS "ListingFavorite_userId_idx"
  ON "ListingFavorite" ("userId");

CREATE INDEX IF NOT EXISTS "ListingFavorite_listingId_idx"
  ON "ListingFavorite" ("listingId");
