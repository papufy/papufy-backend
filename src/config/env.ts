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

function parseOptionalUrl(
  value: unknown,
  label: string
): string | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  try {
    const normalized = /^https?:\/\//i.test(trimmed)
      ? trimmed
      : `https://${trimmed}`;
    const url = new URL(normalized);
    if (url.protocol !== "https:" && url.protocol !== "http:") {
      throw new Error("protocolo inválido");
    }
    return url.href.replace(/\/$/, "");
  } catch {
    console.warn(
      `[env] ${label} inválida — pagamentos Asaas ficam desativados até corrigir no Render.`
    );
    return undefined;
  }
}

function parseOptionalSecret(
  value: unknown,
  minLength: number
): string | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  if (!trimmed || trimmed.length < minLength) return undefined;
  return trimmed;
}

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
  ASAAS_API_URL: z.preprocess(
    (value) => parseOptionalUrl(value, "ASAAS_API_URL"),
    z.string().optional()
  ),
  ASAAS_API_KEY: z.preprocess(
    (value) => parseOptionalSecret(value, 10),
    z.string().optional()
  ),
  ASAAS_WEBHOOK_TOKEN: z.preprocess(
    (value) => parseOptionalSecret(value, 8),
    z.string().optional()
  ),
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

/** Domínio customizado de produção (além de FRONTEND_URL / CORS_ORIGIN no Render). */
const PRODUCTION_SITE_ORIGINS = [
  "https://papufy.com",
  "https://www.papufy.com",
];

function expandOriginVariants(origin: string): string[] {
  const clean = origin.replace(/\/$/, "");
  const variants = new Set<string>([clean]);
  try {
    const { protocol, hostname } = new URL(clean);
    if (hostname.startsWith("www.")) {
      variants.add(`${protocol}//${hostname.slice(4)}`);
    } else {
      variants.add(`${protocol}//www.${hostname}`);
    }
  } catch {
    /* URL inválida — mantém só o valor bruto */
  }
  return [...variants];
}

function buildCorsOrigins(frontendUrl: string): string[] {
  const origins = new Set<string>();

  for (const origin of [
    frontendUrl,
    ...(config.CORS_ORIGIN?.split(",").map((o) => o.trim()).filter(Boolean) ??
      []),
    ...PRODUCTION_SITE_ORIGINS,
  ]) {
    expandOriginVariants(origin).forEach((o) => origins.add(o));
  }

  return [...origins];
}

const publicBaseUrl = resolvePublicBaseUrl();
const frontendUrl = config.FRONTEND_URL.replace(/\/$/, "");
const corsOrigins = buildCorsOrigins(frontendUrl);

export function isCorsOriginAllowed(origin: string | undefined): boolean {
  if (!origin) return true;
  const normalized = origin.replace(/\/$/, "");
  if (corsOrigins.includes(normalized)) return true;
  try {
    const host = new URL(normalized).hostname;
    if (host.endsWith(".vercel.app")) return true;
    if (host === "papufy.com" || host === "www.papufy.com") return true;
    for (const allowed of corsOrigins) {
      const allowedHost = new URL(allowed).hostname;
      if (host === allowedHost) return true;
      if (host === `www.${allowedHost}` || `www.${host}` === allowedHost) {
        return true;
      }
    }
  } catch {
    return false;
  }
  return false;
}

const paymentsEnabled = Boolean(
  config.ASAAS_API_URL && config.ASAAS_API_KEY
);

export const env = {
  ...config,
  FRONTEND_URL: frontendUrl,
  corsOrigins,
  isProduction: true,
  uploadDir: path.resolve(config.UPLOAD_DIR),
  publicBaseUrl,
  paymentsEnabled,
  ASAAS_API_URL: config.ASAAS_API_URL?.replace(/\/$/, "") ?? "",
  ASAAS_API_KEY: config.ASAAS_API_KEY ?? "",
  ASAAS_WEBHOOK_TOKEN: config.ASAAS_WEBHOOK_TOKEN ?? "",
};
