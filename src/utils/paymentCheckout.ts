import { sanitizePhone } from "./sanitize";

export interface CreditCardPayload {
  holderName: string;
  number: string;
  expiryMonth: string;
  expiryYear: string;
  ccv: string;
}

export interface CreditCardHolderPayload {
  name: string;
  email: string;
  cpfCnpj: string;
  postalCode: string;
  addressNumber: string;
  phone: string;
}

export interface PaymentProfilePatch {
  cpfCnpj?: string;
  telefone?: string;
  cidade?: string;
  uf?: string;
  dataNascimento?: string;
}

export interface CheckoutPaymentInput {
  billingType: "PIX" | "CREDIT_CARD";
  creditCard?: CreditCardPayload;
  creditCardHolderInfo?: CreditCardHolderPayload;
  remoteIp?: string;
  /** Dados extras do pagador no primeiro pagamento (ex.: CPF ausente no cadastro). */
  payerProfile?: PaymentProfilePatch;
}

export function normalizeCheckoutPaymentInput(input: CheckoutPaymentInput): {
  billingType: "PIX" | "CREDIT_CARD";
  creditCard?: CreditCardPayload;
  creditCardHolderInfo?: CreditCardHolderPayload;
  remoteIp: string;
} {
  const remoteIp = input.remoteIp?.trim() || "127.0.0.1";

  if (input.billingType !== "CREDIT_CARD") {
    return { billingType: input.billingType, remoteIp };
  }

  if (!input.creditCard || !input.creditCardHolderInfo) {
    throw new Error("Dados do cartão incompletos.");
  }

  const yearRaw = input.creditCard.expiryYear.replace(/\D/g, "");
  const expiryYear =
    yearRaw.length === 2 ? `20${yearRaw}` : yearRaw.slice(0, 4);

  return {
    billingType: input.billingType,
    remoteIp,
    creditCard: {
      holderName: input.creditCard.holderName.trim(),
      number: input.creditCard.number.replace(/\D/g, ""),
      expiryMonth: input.creditCard.expiryMonth.replace(/\D/g, "").padStart(2, "0"),
      expiryYear,
      ccv: input.creditCard.ccv.replace(/\D/g, ""),
    },
    creditCardHolderInfo: {
      name: input.creditCardHolderInfo.name.trim(),
      email: input.creditCardHolderInfo.email.trim().toLowerCase(),
      cpfCnpj: input.creditCardHolderInfo.cpfCnpj.replace(/\D/g, ""),
      postalCode: input.creditCardHolderInfo.postalCode.replace(/\D/g, ""),
      addressNumber: input.creditCardHolderInfo.addressNumber.trim(),
      phone: sanitizePhone(input.creditCardHolderInfo.phone),
    },
  };
}

export const PLATFORM_SPLIT_PERCENT = 93.0;

export function buildAsaasSplit(walletId: string) {
  return [
    {
      walletId,
      percentualValue: PLATFORM_SPLIT_PERCENT,
    },
  ];
}
