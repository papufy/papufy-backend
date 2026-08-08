import { env } from "../config/env";
import { badRequest } from "../utils/errors";
import { pagarmeProvider } from "./pagarmeProvider";
import type { PaymentProvider, PspName } from "./types";

/** Provider ativo (somente Pagar.me). */
export function getPaymentProvider(): PaymentProvider {
  if (!env.paymentsEnabled) {
    throw badRequest(
      "Pagamentos temporariamente indisponíveis. Tente novamente em instantes."
    );
  }
  return pagarmeProvider;
}

export function getActivePspName(): PspName | null {
  return env.paymentProvider;
}

export type { PaymentProvider, PspName } from "./types";
