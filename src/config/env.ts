import dotenv from "dotenv";
import path from "path";
import { z } from "zod";

dotenv.config();

const productionUrl = z
  .string()
  .url()
  .refine((v) => v.startsWith("https://"), {
    message: "Use URL HTTPS de produção (sem localhost).",
  })
  .refine((v) => !/localhost|127\.0\.0\.1/i.test(v), {
    message: "URL local não permitida — projeto só produção.",
  });

const envSchema = z.object({
  SUPABASE_URL: productionUrl,
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(20),
  JWT_SECRET: z.string().min(16),
  JWT_EXPIRES_IN: z.string().default("7d"),
  PORT: z.coerce.number().default(10000),
  HOST: z.string().default("0.0.0.0"),
  NODE_ENV: z.literal("production").default("production"),
  CORS_ORIGIN: z.string().optional(),
  FRONTEND_URL: productionUrl,
  PUBLIC_BASE_URL: productionUrl.optional(),
  UPLOAD_DIR: z.string().default("./uploads"),
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  console.error(
    "Variáveis inválidas (Supabase API + Vercel + Render):",
    parsed.error.flatten().fieldErrors
  );
  process.exit(1);
}

const config = parsed.data;

function resolvePublicBaseUrl(): string {
  if (config.PUBLIC_BASE_URL) {
    return config.PUBLIC_BASE_URL.replace(/\/$/, "");
  }

  const renderUrl = process.env.RENDER_EXTERNAL_URL?.trim();
  if (renderUrl?.startsWith("https://")) {
    return renderUrl.replace(/\/$/, "");
  }

  console.error(
    "Defina PUBLIC_BASE_URL (https://seu-servico.onrender.com) ou deploy no Render (RENDER_EXTERNAL_URL)."
  );
  process.exit(1);
}

function buildCorsOrigins(frontendUrl: string): string[] {
  const origins = new Set<string>();
  origins.add(frontendUrl);

  if (config.CORS_ORIGIN) {
    config.CORS_ORIGIN.split(",")
      .map((o) => o.trim())
      .filter(Boolean)
      .forEach((o) => origins.add(o.replace(/\/$/, "")));
  }

  return [...origins];
}

const publicBaseUrl = resolvePublicBaseUrl();
const frontendUrl = config.FRONTEND_URL.replace(/\/$/, "");
const corsOrigins = buildCorsOrigins(frontendUrl);

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
  FRONTEND_URL: frontendUrl,
  corsOrigins,
  isProduction: true,
  uploadDir: path.resolve(config.UPLOAD_DIR),
  publicBaseUrl,
};
