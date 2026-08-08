import { env } from "../config/env";
import { badRequest } from "../utils/errors";
import { pagarmeProvider } from "./pagarmeProvider";
import type { PaymentProvider, PspName } from "./types";

/** Provider ativo (somente Pagar.me). */
export function getPaymentProvider(): PaymentProvider {
  if (!env.paymentsEnabled) {
    throw badRequest(
      "Pagamentos não configurados. Defina PAGARME_SECRET_KEY no Render."
    );
  }
  return pagarmeProvider;
}

export function getActivePspName(): PspName | null {
  return env.paymentProvider;
}

export type { PaymentProvider, PspName } from "./types";
