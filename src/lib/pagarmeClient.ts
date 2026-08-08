import { env } from "../config/env";
import { badRequest } from "../utils/errors";

interface PagarmeErrorBody {
  message?: string;
  errors?: Record<string, string[]>;
}

function extractPagarmeMessage(json: unknown): string {
  if (!json || typeof json !== "object") {
    return "Erro ao comunicar com Pagar.me.";
  }
  const body = json as PagarmeErrorBody;
  if (body.message?.trim()) return body.message.trim();
  if (body.errors && typeof body.errors === "object") {
    const parts = Object.entries(body.errors).flatMap(([field, msgs]) =>
      (msgs ?? []).map((m) => `${field}: ${m}`)
    );
    if (parts.length) return parts.join(" ");
  }
  return "Erro ao comunicar com Pagar.me.";
}

function basicAuthHeader(secretKey: string): string {
  // Pagar.me v5: Basic base64(secret_key + ":")
  const token = Buffer.from(`${secretKey}:`, "utf8").toString("base64");
  return `Basic ${token}`;
}

export async function pagarmeRequest<T>(
  path: string,
  init?: RequestInit & { expectedStatus?: number[] }
): Promise<T> {
  if (!env.PAGARME_SECRET_KEY) {
    throw badRequest(
      "Pagamentos Pagar.me não configurados. Defina PAGARME_SECRET_KEY."
    );
  }

  const expected = init?.expectedStatus ?? [200, 201];
  const url = `${env.PAGARME_API_URL}${path.startsWith("/") ? path : `/${path}`}`;

  let response: Response;
  try {
    response = await fetch(url, {
      method: init?.method ?? "GET",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
        Authorization: basicAuthHeader(env.PAGARME_SECRET_KEY),
        ...(init?.headers ?? {}),
      },
      body: init?.body,
    });
  } catch (err) {
    const detail = err instanceof Error ? err.message : "falha de rede";
    throw badRequest(
      `Não foi possível conectar ao Pagar.me. Verifique PAGARME_API_URL e a rede. (${detail})`
    );
  }

  const text = await response.text();
  let json: unknown = {};
  if (text) {
    try {
      json = JSON.parse(text) as unknown;
    } catch {
      json = { raw: text };
    }
  }

  if (!expected.includes(response.status)) {
    const message = extractPagarmeMessage(json);
    console.error("[pagarme]", response.status, path, message);
    throw badRequest(message);
  }

  return json as T;
}

export interface PagarmePixData {
  qr_code?: string;
  qr_code_url?: string;
  expires_at?: string;
}

export interface PagarmeCharge {
  id: string;
  status?: string;
  payment_method?: string;
  last_transaction?: {
    qr_code?: string;
    qr_code_url?: string;
    qr_code_base64?: string;
    status?: string;
  };
}

export interface PagarmeOrder {
  id: string;
  status?: string;
  charges?: PagarmeCharge[];
  customer?: { id?: string };
}

export interface PagarmeRecipient {
  id: string;
  status?: string;
  name?: string;
  email?: string;
  document?: string;
}

/** Mapeia status de charge/order Pagar.me → TransactionStatus Papufy. */
export function mapPagarmePaymentStatus(
  status: string | undefined | null
): "PENDING" | "PAID" | "CANCELED" | "FAILED" {
  const s = (status ?? "").toLowerCase();
  if (["paid", "captured"].includes(s)) return "PAID";
  if (["pending", "processing", "waiting_payment", "authorized"].includes(s)) {
    return "PENDING";
  }
  if (["canceled", "cancelled", "failed", "chargedback"].includes(s)) {
    return s.includes("fail") || s.includes("charge") ? "FAILED" : "CANCELED";
  }
  return "PENDING";
}
