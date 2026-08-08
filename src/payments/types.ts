import type { CheckoutPaymentInput } from "../utils/paymentCheckout";

export type PspName = "pagarme";

export interface PspChargeResult {
  paymentId: string;
  status: "PENDING" | "PAID" | "CANCELED" | "FAILED";
  invoiceUrl?: string | null;
  dueDate?: string | null;
  pixCopyPaste?: string | null;
  pixQrCodeImage?: string | null;
  raw?: unknown;
}

export interface PspRecipientResult {
  recipientId: string;
  walletId?: string | null;
  accountId?: string | null;
  status?: string | null;
}

export interface PspCustomerResult {
  customerId: string;
}

export interface BankAccountInput {
  holderName: string;
  holderType: "individual" | "company";
  holderDocument: string;
  bank: string;
  branchNumber: string;
  branchCheckDigit?: string;
  accountNumber: string;
  accountCheckDigit: string;
  type: "checking" | "savings";
}

export interface RecipientAddressInput {
  street: string;
  streetNumber: string;
  complementary?: string;
  neighborhood: string;
  city: string;
  state: string;
  zipCode: string;
  referencePoint?: string;
}

export interface EnsureRecipientInput {
  userId: string;
  nome: string;
  email: string;
  cpfCnpj: string;
  telefone: string;
  dataNascimento?: string | null;
  /** Renda mensal em centavos (PF) — default 300000 */
  monthlyIncomeCents?: number;
  professionalOccupation?: string;
  motherName?: string;
  address?: RecipientAddressInput;
  bankAccount?: BankAccountInput;
}

export interface ChargeWithSplitInput extends CheckoutPaymentInput {
  customerId: string;
  professionalRecipientId: string;
  amountCents: number;
  description: string;
  externalReference: string;
}

/** Cobrança 100% na conta da plataforma (sem split marketplace). */
export interface ChargePlatformOnlyInput {
  customerId: string;
  amountCents: number;
  description: string;
  externalReference: string;
  /** Só PIX na v1 de renovação. */
  billingType?: "PIX";
}

export interface PspBalanceResult {
  /** Saldo disponível em reais */
  available: number;
  waitingFunds?: number;
  transferred?: number;
}

export interface PspWithdrawInput {
  value: number;
  recipientId: string;
}

export interface PspWithdrawResult {
  transferId: string;
  status?: string;
}

export interface PaymentProvider {
  readonly name: PspName;

  ensureCustomer(input: {
    userId: string;
    nome: string;
    email: string;
    cpfCnpj: string;
    telefone?: string | null;
    dataNascimento?: string | null;
    existingCustomerId?: string | null;
  }): Promise<PspCustomerResult>;

  ensureRecipient(
    input: EnsureRecipientInput & {
      existingRecipientId?: string | null;
    }
  ): Promise<PspRecipientResult>;

  chargeWithSplit(input: ChargeWithSplitInput): Promise<PspChargeResult>;

  chargePlatformOnly(input: ChargePlatformOnlyInput): Promise<PspChargeResult>;

  getPaymentStatus(paymentId: string): Promise<{
    status: "PENDING" | "PAID" | "CANCELED" | "FAILED";
    raw?: unknown;
  }>;

  getBalance(input: { recipientId: string }): Promise<PspBalanceResult>;

  withdraw(input: PspWithdrawInput): Promise<PspWithdrawResult>;
}
