import { env } from "../config/env";
import { badRequest } from "../utils/errors";

interface AsaasError {
  errors?: Array<{ description?: string }>;
}

export interface AsaasPixQrCode {
  encodedImage?: string;
  payload?: string;
  expirationDate?: string;
}

export interface AsaasPaymentResponse {
  id: string;
  status: string;
  invoiceUrl?: string;
  bankSlipUrl?: string;
  dueDate?: string;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function extractAsaasMessage(json: unknown): string {
  if (
    json &&
    typeof json === "object" &&
    "errors" in json &&
    Array.isArray((json as AsaasError).errors) &&
    (json as AsaasError).errors?.[0]?.description
  ) {
    return (json as AsaasError).errors![0]!.description!;
  }
  return "Erro ao comunicar com Asaas.";
}

export async function asaasRequest<T>(
  path: string,
  init?: RequestInit & { expectedStatus?: number[] }
): Promise<T> {
  const expected = init?.expectedStatus ?? [200, 201];
  const url = `${env.ASAAS_API_URL.replace(/\/$/, "")}${path.startsWith("/") ? path : `/${path}`}`;

  let response: Response;
  try {
    response = await fetch(url, {
      method: init?.method ?? "GET",
      headers: {
        "Content-Type": "application/json",
        access_token: env.ASAAS_API_KEY,
        ...(init?.headers ?? {}),
      },
      body: init?.body,
    });
  } catch (err) {
    const detail = err instanceof Error ? err.message : "falha de rede";
    throw badRequest(
      `Não foi possível conectar ao Asaas. Verifique ASAAS_API_URL e a rede do servidor. (${detail})`
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
    throw badRequest(extractAsaasMessage(json));
  }

  return json as T;
}

/**
 * Requisição autenticada com a API key da subconta (não a conta master).
 * O Asaas identifica a carteira pelo token — use para saldo e transferências Pix do profissional.
 */
export async function asaasSubaccountRequest<T>(
  path: string,
  subaccountApiKey: string,
  init?: RequestInit & { expectedStatus?: number[] }
): Promise<T> {
  const key = subaccountApiKey.trim();
  if (!key) {
    throw badRequest("Chave de API da subconta Asaas não configurada.");
  }

  return asaasRequest<T>(path, {
    ...init,
    headers: {
      ...(init?.headers ?? {}),
      access_token: key,
      "asaas-access-token": key,
    },
  });
}

export interface AsaasFinanceBalance {
  balance: number;
}

export interface AsaasTransferResponse {
  id: string;
  status?: string;
  value?: number;
}

/** Após POST /payments (PIX), o QR pode demorar alguns ms para ficar disponível. */
export async function fetchAsaasPixQrCode(
  paymentId: string,
  attempts = 8
): Promise<AsaasPixQrCode> {
  let lastPix: AsaasPixQrCode = {};
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      const pix = await asaasRequest<AsaasPixQrCode>(
        `/payments/${paymentId}/pixQrCode`,
        { expectedStatus: [200] }
      );
      lastPix = pix;
      if (pix.payload?.trim() || pix.encodedImage?.trim()) {
        return pix;
      }
    } catch (err) {
      if (attempt === attempts - 1) {
        throw err;
      }
    }
    await sleep(400 * (attempt + 1));
  }
  return lastPix;
}

export function mapAsaasPaymentStatus(asaasStatus: string): "PAID" | "PENDING" {
  const normalized = asaasStatus.toUpperCase();
  if (normalized === "RECEIVED" || normalized === "CONFIRMED") {
    return "PAID";
  }
  return "PENDING";
}

export function normalizePixEncodedImage(encoded?: string | null): string | undefined {
  if (!encoded?.trim()) return undefined;
  const trimmed = encoded.trim();
  if (trimmed.startsWith("data:")) return trimmed;
  return `data:image/png;base64,${trimmed}`;
}
