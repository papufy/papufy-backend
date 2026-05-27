import fs from "fs";
import path from "path";
import pg from "pg";
import { env } from "../config/env";

const CHAT_PROPOSAL_MIGRATION = "20260527130000_chat_proposal_dispute.sql";

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

export async function ensureDatabaseSchema(): Promise<void> {
  const databaseUrl = resolveDatabaseUrl();
  if (!databaseUrl) {
    console.warn(
      "[schema] DATABASE_URL ou SUPABASE_DB_PASSWORD não definidos — migração automática ignorada."
    );
    return;
  }

  const migrationPath = path.join(
    process.cwd(),
    "supabase",
    "migrations",
    CHAT_PROPOSAL_MIGRATION
  );
  if (!fs.existsSync(migrationPath)) {
    console.warn(`[schema] Arquivo não encontrado: ${migrationPath}`);
    return;
  }

  const sql = fs.readFileSync(migrationPath, "utf8");
  const client = new pg.Client({
    connectionString: databaseUrl,
    ssl: { rejectUnauthorized: false },
  });

  try {
    await client.connect();
    await client.query(sql);
    console.log("[schema] Migração chat/proposta aplicada (ou já existente).");
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[schema] Falha ao aplicar migração:", message);
  } finally {
    await client.end().catch(() => undefined);
  }
}
