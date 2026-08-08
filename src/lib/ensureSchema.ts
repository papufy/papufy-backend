import pg from "pg";
import { env } from "../config/env";

/**
 * Migrações idempotentes aplicadas no boot do Render.
 * Usa information_schema / exception handlers — sem sintaxes
 * que o Postgres rejeita (ex.: CREATE TYPE IF NOT EXISTS).
 *
 * Banco: SUPABASE_URL da Papufy (ex.: lyxdjprsfstxqakudhjd.supabase.co)
 * via DATABASE_URL ou SUPABASE_DB_PASSWORD.
 */

function resolveDatabaseUrl(): string | null {
  const direct = process.env.DATABASE_URL?.trim();
  if (direct) return direct;

  const password = process.env.SUPABASE_DB_PASSWORD?.trim();
  if (!password) return null;

  try {
    const ref = new URL(env.SUPABASE_URL).hostname.split(".")[0];
    return `postgresql://postgres:${encodeURIComponent(password)}@db.${ref}.supabase.co:5432/postgres`;
  } catch {
    return null;
  }
}

function maskDatabaseUrl(url: string): string {
  try {
    const u = new URL(url);
    return `${u.protocol}//${u.username ? "***@" : ""}${u.hostname}:${u.port || "5432"}${u.pathname}`;
  } catch {
    return "(url inválida)";
  }
}

async function columnExists(
  client: pg.Client,
  table: string,
  column: string
): Promise<boolean> {
  const result = await client.query<{ exists: boolean }>(
    `SELECT EXISTS (
       SELECT 1
       FROM information_schema.columns
       WHERE table_schema = 'public'
         AND table_name = $1
         AND column_name = $2
     ) AS exists`,
    [table, column]
  );
  return Boolean(result.rows[0]?.exists);
}

async function addColumnIfMissing(
  client: pg.Client,
  table: string,
  column: string,
  definition: string
): Promise<void> {
  if (await columnExists(client, table, column)) return;
  await client.query(
    `ALTER TABLE "${table}" ADD COLUMN "${column}" ${definition}`
  );
  console.log(`[schema] + ${table}.${column}`);
}

async function dropColumnIfPresent(
  client: pg.Client,
  table: string,
  column: string
): Promise<void> {
  if (!(await columnExists(client, table, column))) return;
  await client.query(`ALTER TABLE "${table}" DROP COLUMN "${column}"`);
  console.log(`[schema] - ${table}.${column}`);
}

async function ensureIndex(
  client: pg.Client,
  indexName: string,
  createSql: string
): Promise<void> {
  const result = await client.query<{ exists: boolean }>(
    `SELECT EXISTS (
       SELECT 1 FROM pg_indexes
       WHERE schemaname = 'public' AND indexname = $1
     ) AS exists`,
    [indexName]
  );
  if (result.rows[0]?.exists) return;
  await client.query(createSql);
  console.log(`[schema] + index ${indexName}`);
}

export async function ensureDatabaseSchema(): Promise<void> {
  const databaseUrl = resolveDatabaseUrl();
  if (!databaseUrl) {
    console.warn(
      "[schema] DATABASE_URL ou SUPABASE_DB_PASSWORD não definidos — migração automática ignorada."
    );
    return;
  }

  const hostHint = maskDatabaseUrl(databaseUrl);
  console.log(`[schema] Conectando em ${hostHint}`);
  console.log(`[schema] SUPABASE_URL ref: ${env.SUPABASE_URL}`);

  const client = new pg.Client({
    connectionString: databaseUrl,
    ssl: { rejectUnauthorized: false },
  });

  try {
    await client.connect();

    // --- Perfil ---
    await addColumnIfMissing(client, "User", "fotoUrl", "TEXT");

    // --- Pagar.me columns ---
    await addColumnIfMissing(client, "User", "pagarmeCustomerId", "TEXT");
    await addColumnIfMissing(client, "User", "pagarmeRecipientId", "TEXT");
    await addColumnIfMissing(client, "User", "paymentProvider", "TEXT");
    await addColumnIfMissing(client, "Transaction", "pagarmeOrderId", "TEXT");
    await addColumnIfMissing(client, "Transaction", "pagarmeChargeId", "TEXT");
    await addColumnIfMissing(client, "Transaction", "paymentProvider", "TEXT");

    await ensureIndex(
      client,
      "Transaction_pagarmeChargeId_idx",
      `CREATE INDEX "Transaction_pagarmeChargeId_idx" ON "Transaction" ("pagarmeChargeId")`
    );
    await ensureIndex(
      client,
      "User_pagarmeRecipientId_idx",
      `CREATE INDEX "User_pagarmeRecipientId_idx" ON "User" ("pagarmeRecipientId")`
    );

    // --- Drop Asaas (legado) ---
    await client.query(
      `DROP INDEX IF EXISTS "Transaction_asaasPaymentId_key"`
    );
    await dropColumnIfPresent(client, "Transaction", "asaasPaymentId");
    await dropColumnIfPresent(client, "User", "asaasCustomerId");
    await dropColumnIfPresent(client, "User", "asaasWalletId");
    await dropColumnIfPresent(client, "User", "asaasAccountId");
    await dropColumnIfPresent(client, "User", "asaasSubaccountApiKey");

    // Bucket público para foto/currículo/certificados (idempotente)
    try {
      await client.query(`
        INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
        VALUES (
          'user-files',
          'user-files',
          true,
          5242880,
          ARRAY['image/jpeg', 'image/png', 'application/pdf']::text[]
        )
        ON CONFLICT (id) DO UPDATE
        SET
          public = EXCLUDED.public,
          file_size_limit = EXCLUDED.file_size_limit,
          allowed_mime_types = EXCLUDED.allowed_mime_types
      `);
      await client.query(`
        DO $$
        BEGIN
          IF NOT EXISTS (
            SELECT 1 FROM pg_policies
            WHERE schemaname = 'storage'
              AND tablename = 'objects'
              AND policyname = 'Public read user files'
          ) THEN
            CREATE POLICY "Public read user files"
            ON storage.objects
            FOR SELECT
            TO public
            USING (bucket_id = 'user-files');
          END IF;
        END
        $$;
      `);
      console.log("[schema] Bucket user-files ok.");
    } catch (bucketErr) {
      const msg =
        bucketErr instanceof Error ? bucketErr.message : String(bucketErr);
      console.warn("[schema] Bucket user-files (aviso):", msg);
    }

    // --- Favoritos de anúncios ---
    try {
      await client.query(`
        CREATE TABLE IF NOT EXISTS "ListingFavorite" (
          "id" TEXT PRIMARY KEY,
          "userId" TEXT NOT NULL REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE,
          "listingId" TEXT NOT NULL REFERENCES "Listing"("id") ON DELETE CASCADE ON UPDATE CASCADE,
          "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
        )
      `);
      await ensureIndex(
        client,
        "ListingFavorite_userId_listingId_key",
        `CREATE UNIQUE INDEX "ListingFavorite_userId_listingId_key" ON "ListingFavorite" ("userId", "listingId")`
      );
      await ensureIndex(
        client,
        "ListingFavorite_userId_idx",
        `CREATE INDEX "ListingFavorite_userId_idx" ON "ListingFavorite" ("userId")`
      );
      console.log("[schema] ListingFavorite ok.");
    } catch (favErr) {
      const msg = favErr instanceof Error ? favErr.message : String(favErr);
      console.warn("[schema] ListingFavorite (aviso):", msg);
    }

    console.log("[schema] Schema ok.");
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[schema] Falha ao aplicar migração:", message);
  } finally {
    await client.end().catch(() => undefined);
  }
}
