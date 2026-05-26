import dotenv from "dotenv";
import path from "path";
import { z } from "zod";

dotenv.config();

const envSchema = z.object({
  DATABASE_URL: z
    .string()
    .min(1)
    .refine((v) => v.startsWith("postgresql://"), {
      message: "DATABASE_URL deve ser PostgreSQL (Supabase).",
    }),
  DIRECT_URL: z
    .string()
    .min(1)
    .refine((v) => v.startsWith("postgresql://"), {
      message: "DIRECT_URL deve ser PostgreSQL (Supabase).",
    }),
  JWT_SECRET: z.string().min(16),
  JWT_EXPIRES_IN: z.string().default("7d"),
  PORT: z.coerce.number().default(10000),
  HOST: z.string().default("0.0.0.0"),
  NODE_ENV: z.enum(["production", "test"]).default("production"),
  CORS_ORIGIN: z.string().optional(),
  FRONTEND_URL: z.string().url(),
  PUBLIC_BASE_URL: z.string().url(),
  ASAAS_API_URL: z.string().url().default("https://sandbox.asaas.com/v3"),
  ASAAS_API_KEY: z.string().min(10),
  ASAAS_WEBHOOK_TOKEN: z.string().optional(),
  UPLOAD_DIR: z.string().default("./uploads"),
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  console.error(
    "Variáveis de ambiente inválidas (Supabase + URLs de produção obrigatórias):",
    parsed.error.flatten().fieldErrors
  );
  process.exit(1);
}

const config = parsed.data;

function buildCorsOrigins(): string[] {
  const origins = new Set<string>();
  origins.add(config.FRONTEND_URL.replace(/\/$/, ""));

  if (config.CORS_ORIGIN) {
    config.CORS_ORIGIN.split(",")
      .map((o) => o.trim())
      .filter(Boolean)
      .forEach((o) => origins.add(o));
  }

  return [...origins];
}

const corsOrigins = buildCorsOrigins();

export function isCorsOriginAllowed(origin: string | undefined): boolean {
  if (!origin) return true;
  if (corsOrigins.includes(origin)) return true;
  try {
    const host = new URL(origin).hostname;
    if (host.endsWith(".vercel.app")) return true;
  } catch {
    return false;
  }
  return false;
}

export const env = {
  ...config,
  corsOrigins,
  isProduction: true,
  uploadDir: path.resolve(config.UPLOAD_DIR),
  publicBaseUrl: config.PUBLIC_BASE_URL.replace(/\/$/, ""),
};
