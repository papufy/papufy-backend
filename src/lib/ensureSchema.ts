import fs from "fs";
import path from "path";
import pg from "pg";
import { env } from "../config/env";

const AUTO_MIGRATIONS = [
  "20260527130000_chat_proposal_dispute.sql",
  "20260710180000_user_qualificacoes.sql",
  "20260710190000_preco_faixa_diferenciais.sql",
] as const;

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

  const client = new pg.Client({
    connectionString: databaseUrl,
    ssl: { rejectUnauthorized: false },
  });

  try {
    await client.connect();
    for (const file of AUTO_MIGRATIONS) {
      const migrationPath = path.join(
        process.cwd(),
        "supabase",
        "migrations",
        file
      );
      if (!fs.existsSync(migrationPath)) {
        console.warn(`[schema] Arquivo não encontrado: ${migrationPath}`);
        continue;
      }
      const sql = fs.readFileSync(migrationPath, "utf8");
      await client.query(sql);
      console.log(`[schema] Migração aplicada (ou já existente): ${file}`);
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[schema] Falha ao aplicar migração:", message);
  } finally {
    await client.end().catch(() => undefined);
  }
}
