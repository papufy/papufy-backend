import { env } from "../config/env";
import {
  mapPagarmePaymentStatus,
  pagarmeRequest,
  type PagarmeOrder,
  type PagarmeRecipient,
} from "../lib/pagarmeClient";
import { PLATFORM_SPLIT_PERCENT } from "../utils/paymentCheckout";
import { badRequest } from "../utils/errors";
import { normalizeBirthDateIso } from "../utils/birthDate";
import type {
  ChargeWithSplitInput,
  EnsureRecipientInput,
  PaymentProvider,
  PspBalanceResult,
  PspChargeResult,
  PspCustomerResult,
  PspRecipientResult,
  PspWithdrawInput,
  PspWithdrawResult,
} from "./types";

function digits(value: string): string {
  return value.replace(/\D/g, "");
}

function phoneParts(telefone: string): { ddd: string; number: string } {
  const d = digits(telefone);
  const withCountry = d.startsWith("55") && d.length >= 12 ? d.slice(2) : d;
  return {
    ddd: withCountry.slice(0, 2) || "11",
    number: withCountry.slice(2) || "999999999",
  };
}

/** Pagar.me PF espera birthdate em DD/MM/YYYY. */
function birthdateBr(isoOrNull?: string | null): string {
  const iso = normalizeBirthDateIso(isoOrNull);
  if (!iso) {
    throw badRequest(
      "Informe a data de nascimento para cadastrar o recebedor na Pagar.me."
    );
  }
  const [y, m, d] = iso.split("-");
  return `${d}/${m}/${y}`;
}

function normalizePixImage(value?: string | null): string | null {
  if (!value?.trim()) return null;
  const v = value.trim();
  if (v.startsWith("data:") || v.startsWith("http")) return v;
  return `data:image/png;base64,${v}`;
}

/**
 * Provider Pagar.me (API Core v5) — customer, recipient, order/split, saldo e saque.
 */
export const pagarmeProvider: PaymentProvider = {
  name: "pagarme",

  async ensureCustomer(input): Promise<PspCustomerResult> {
    if (input.existingCustomerId?.trim()) {
      return { customerId: input.existingCustomerId.trim() };
    }

    const doc = digits(input.cpfCnpj);
    const phones = input.telefone
      ? {
          mobile_phone: {
            country_code: "55",
            area_code: phoneParts(input.telefone).ddd,
            number: phoneParts(input.telefone).number,
          },
        }
      : undefined;

    const customer = await pagarmeRequest<{ id: string }>("/customers", {
      method: "POST",
      body: JSON.stringify({
        name: input.nome,
        email: input.email,
        type: doc.length === 14 ? "company" : "individual",
        document: doc,
        document_type: doc.length === 14 ? "CNPJ" : "CPF",
        code: input.userId,
        ...(phones ? { phones } : {}),
      }),
    });

    if (!customer.id) {
      throw badRequest("Pagar.me não retornou customer id.");
    }
    return { customerId: customer.id };
  },

  async ensureRecipient(
    input: EnsureRecipientInput & { existingRecipientId?: string | null }
  ): Promise<PspRecipientResult> {
    if (input.existingRecipientId?.trim()) {
      return {
        recipientId: input.existingRecipientId.trim(),
        walletId: input.existingRecipientId.trim(),
        accountId: input.existingRecipientId.trim(),
      };
    }

    if (!input.bankAccount) {
      throw badRequest(
        "Para receber na Pagar.me, informe os dados da conta bancária."
      );
    }
    if (!input.address) {
      throw badRequest(
        "Para receber na Pagar.me, informe o endereço completo do recebedor."
      );
    }

    const doc = digits(input.cpfCnpj);
    const isCompany = doc.length === 14;
    const ba = input.bankAccount;
    const addr = input.address;
    const phone = phoneParts(input.telefone);
    const monthlyIncome = input.monthlyIncomeCents ?? 300_000;
    const occupation =
      input.professionalOccupation?.trim() || "Prestador de serviços";

    const addressPayload = {
      street: addr.street.trim(),
      complementary: addr.complementary?.trim() || "N/A",
      street_number: addr.streetNumber.trim(),
      neighborhood: addr.neighborhood.trim(),
      city: addr.city.trim(),
      state: addr.state.trim().toUpperCase().slice(0, 2),
      zip_code: digits(addr.zipCode),
      reference_point: addr.referencePoint?.trim() || "N/A",
    };

    const phoneNumbers = [
      { ddd: phone.ddd, number: phone.number, type: "mobile" },
    ];

    const register_information = isCompany
      ? {
          company_name: input.nome,
          trading_name: input.nome,
          email: input.email,
          document: doc,
          type: "corporation",
          annual_revenue: monthlyIncome * 12,
          main_address: addressPayload,
          phone_numbers: phoneNumbers,
          managing_partners: [
            {
              name: ba.holderName,
              email: input.email,
              document: digits(ba.holderDocument),
              type: "individual",
              birthdate: birthdateBr(input.dataNascimento),
              monthly_income: monthlyIncome,
              professional_occupation: occupation,
              self_declared_legal_representative: true,
              address: addressPayload,
              phone_numbers: phoneNumbers,
            },
          ],
        }
      : {
          name: input.nome,
          email: input.email,
          document: doc,
          type: "individual",
          birthdate: birthdateBr(input.dataNascimento),
          monthly_income: monthlyIncome,
          professional_occupation: occupation,
          ...(input.motherName?.trim()
            ? { mother_name: input.motherName.trim() }
            : {}),
          address: addressPayload,
          phone_numbers: phoneNumbers,
        };

    const recipient = await pagarmeRequest<PagarmeRecipient>("/recipients", {
      method: "POST",
      body: JSON.stringify({
        code: input.userId,
        register_information,
        default_bank_account: {
          holder_name: ba.holderName,
          holder_type: ba.holderType,
          holder_document: digits(ba.holderDocument),
          bank: digits(ba.bank).padStart(3, "0").slice(0, 3),
          branch_number: digits(ba.branchNumber),
          ...(ba.branchCheckDigit
            ? { branch_check_digit: ba.branchCheckDigit }
            : {}),
          account_number: digits(ba.accountNumber),
          account_check_digit: ba.accountCheckDigit,
          type: ba.type,
        },
        transfer_settings: {
          transfer_enabled: false,
          transfer_interval: "Daily",
          transfer_day: 0,
        },
      }),
    });

    if (!recipient.id) {
      throw badRequest("Pagar.me não retornou recipient id.");
    }

    return {
      recipientId: recipient.id,
      walletId: recipient.id,
      accountId: recipient.id,
      status: recipient.status ?? null,
    };
  },

  async chargeWithSplit(input: ChargeWithSplitInput): Promise<PspChargeResult> {
    if (!env.PAGARME_PLATFORM_RECIPIENT_ID) {
      throw badRequest(
        "Defina PAGARME_PLATFORM_RECIPIENT_ID (recebedor da plataforma Papufy) no ambiente."
      );
    }

    const professionalPercent = Math.round(PLATFORM_SPLIT_PERCENT);
    const platformPercent = 100 - professionalPercent;
    const paymentMethod =
      input.billingType === "CREDIT_CARD" ? "credit_card" : "pix";

    const payment: Record<string, unknown> = {
      payment_method: paymentMethod,
      amount: input.amountCents,
      split: [
        {
          amount: professionalPercent,
          recipient_id: input.professionalRecipientId,
          type: "percentage",
          options: {
            charge_processing_fee: false,
            charge_remainder_fee: false,
            liable: false,
          },
        },
        {
          amount: platformPercent,
          recipient_id: env.PAGARME_PLATFORM_RECIPIENT_ID,
          type: "percentage",
          options: {
            charge_processing_fee: true,
            charge_remainder_fee: true,
            liable: true,
          },
        },
      ],
    };

    if (paymentMethod === "pix") {
      payment.pix = { expires_in: 3600 };
    } else {
      if (!input.creditCard || !input.creditCardHolderInfo) {
        throw badRequest("Dados do cartão incompletos.");
      }
      payment.credit_card = {
        installments: 1,
        statement_descriptor: "PAPUFY",
        card: {
          number: input.creditCard.number,
          holder_name: input.creditCard.holderName,
          exp_month: Number(input.creditCard.expiryMonth),
          exp_year: Number(input.creditCard.expiryYear),
          cvv: input.creditCard.ccv,
        },
      };
    }

    const order = await pagarmeRequest<PagarmeOrder>("/orders", {
      method: "POST",
      body: JSON.stringify({
        customer_id: input.customerId,
        code: input.externalReference.slice(0, 52),
        items: [
          {
            amount: input.amountCents,
            description: input.description.slice(0, 256),
            quantity: 1,
            code: input.externalReference.slice(0, 52),
          },
        ],
        payments: [payment],
      }),
    });

    const charge = order.charges?.[0];
    const lastTx = charge?.last_transaction;
    const status = mapPagarmePaymentStatus(charge?.status ?? order.status);

    return {
      paymentId: charge?.id || order.id,
      status,
      pixCopyPaste: lastTx?.qr_code?.trim() || null,
      pixQrCodeImage: normalizePixImage(
        lastTx?.qr_code_base64 ?? lastTx?.qr_code_url
      ),
      raw: order,
    };
  },

  async getPaymentStatus(paymentId: string) {
    try {
      const charge = await pagarmeRequest<{ id: string; status?: string }>(
        `/charges/${paymentId}`,
        { expectedStatus: [200] }
      );
      return {
        status: mapPagarmePaymentStatus(charge.status),
        raw: charge,
      };
    } catch {
      const order = await pagarmeRequest<PagarmeOrder>(`/orders/${paymentId}`, {
        expectedStatus: [200],
      });
      return {
        status: mapPagarmePaymentStatus(
          order.charges?.[0]?.status ?? order.status
        ),
        raw: order,
      };
    }
  },

  async getBalance(input: { recipientId: string }): Promise<PspBalanceResult> {
    const balance = await pagarmeRequest<{
      available_amount?: number;
      waiting_funds_amount?: number;
      transferred_amount?: number;
    }>(`/recipients/${input.recipientId}/balance`, {
      expectedStatus: [200],
    });

    return {
      available: Number(((balance.available_amount ?? 0) / 100).toFixed(2)),
      waitingFunds: Number(
        ((balance.waiting_funds_amount ?? 0) / 100).toFixed(2)
      ),
      transferred: Number(
        ((balance.transferred_amount ?? 0) / 100).toFixed(2)
      ),
    };
  },

  async withdraw(input: PspWithdrawInput): Promise<PspWithdrawResult> {
    const amountCents = Math.round(input.value * 100);
    if (amountCents < 100) {
      throw badRequest("Valor mínimo de saque: R$ 1,00.");
    }

    const transfer = await pagarmeRequest<{
      id: string;
      status?: string;
    }>(`/recipients/${input.recipientId}/transfers`, {
      method: "POST",
      body: JSON.stringify({ amount: amountCents }),
      expectedStatus: [200, 201],
    });

    if (!transfer.id) {
      throw badRequest("Pagar.me não retornou id da transferência.");
    }

    return {
      transferId: transfer.id,
      status: transfer.status ?? "pending",
    };
  },
};
