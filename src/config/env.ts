import dotenv from "dotenv";
import path from "path";
import { z } from "zod";

dotenv.config();

const envSchema = z.object({
  DATABASE_URL: z.string().min(1),
  DIRECT_URL: z.string().min(1),
  JWT_SECRET: z.string().min(8),
  JWT_EXPIRES_IN: z.string().default("7d"),
  PORT: z.coerce.number().default(3333),
  HOST: z.string().default("0.0.0.0"),
  NODE_ENV: z.enum(["development", "production", "test"]).default("development"),
  CORS_ORIGIN: z.string().optional(),
  FRONTEND_URL: z.string().url().optional(),
  UPLOAD_DIR: z.string().default("./uploads"),
  PUBLIC_BASE_URL: z.string().default("http://127.0.0.1:3333"),
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  console.error(
    "Variáveis de ambiente inválidas:",
    parsed.error.flatten().fieldErrors
  );
  process.exit(1);
}

const config = parsed.data;

function buildCorsOrigins(): string[] {
  const origins = new Set<string>();

  const defaults =
    config.NODE_ENV === "production"
      ? []
      : ["http://localhost:5173", "http://127.0.0.1:5173"];

  defaults.forEach((o) => origins.add(o));

  if (config.CORS_ORIGIN) {
    config.CORS_ORIGIN.split(",")
      .map((o) => o.trim())
      .filter(Boolean)
      .forEach((o) => origins.add(o));
  }

  if (config.FRONTEND_URL) {
    origins.add(config.FRONTEND_URL.replace(/\/$/, ""));
  }

  return [...origins];
}

const corsOrigins = buildCorsOrigins();

export function isCorsOriginAllowed(origin: string | undefined): boolean {
  if (!origin) return true;
  if (corsOrigins.includes(origin)) return true;
  if (config.NODE_ENV === "production") {
    try {
      const host = new URL(origin).hostname;
      if (host.endsWith(".vercel.app")) return true;
    } catch {
      return false;
    }
  }
  return false;
}

export const env = {
  ...config,
  corsOrigins,
  isProduction: config.NODE_ENV === "production",
  uploadDir: path.resolve(config.UPLOAD_DIR),
  publicBaseUrl: config.PUBLIC_BASE_URL.replace(/\/$/, ""),
};
