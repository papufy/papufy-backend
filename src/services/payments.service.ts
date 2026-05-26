import { assertNoError, newId, supabase } from "../lib/db";
import type { Tables } from "../types/database";
import { env } from "../config/env";
import type { BillingType, TransactionStatus } from "../types/enums";
import { sanitizePhone, sanitizeText } from "../utils/sanitize";
import { forbidden, badRequest } from "../utils/errors";

interface AsaasError {
  errors?: Array<{ description?: string }>;
}

interface CreateCheckoutInput {
  listingId: string;
  billingType: BillingType;
  creditCard?: {
    holderName: string;
    number: string;
    expiryMonth: string;
    expiryYear: string;
    ccv: string;
  };
  creditCardHolderInfo?: {
    name: string;
    email: string;
    cpfCnpj: string;
    postalCode: string;
    addressNumber: string;
    phone: string;
  };
}

const USER_PAYMENT_SELECT =
  "id, nome, email, telefone, cidade, uf, curriculoUrl, cpfCnpj, asaasCustomerId, asaasWalletId, createdAt, updatedAt";

async function asaasRequest<T>(
  path: string,
  init?: RequestInit & { expectedStatus?: number[] }
): Promise<T> {
  const expected = init?.expectedStatus ?? [200, 201];
  const response = await fetch(`${env.ASAAS_API_URL}${path}`, {
    method: init?.method ?? "GET",
    headers: {
      "Content-Type": "application/json",
      access_token: env.ASAAS_API_KEY,
      ...(init?.headers ?? {}),
    },
    body: init?.body,
  });

  const json = (await response.json().catch(() => ({}))) as
    | T
    | AsaasError
    | Record<string, unknown>;

  if (!expected.includes(response.status)) {
    const message =
      "errors" in (json as AsaasError) &&
      Array.isArray((json as AsaasError).errors) &&
      (json as AsaasError).errors?.[0]?.description
        ? (json as AsaasError).errors?.[0]?.description
        : "Erro ao comunicar com Asaas.";
    throw badRequest(message ?? "Erro ao comunicar com Asaas.");
  }

  return json as T;
}

function buildDueDate(daysAhead = 1): string {
  const date = new Date();
  date.setDate(date.getDate() + daysAhead);
  return date.toISOString().slice(0, 10);
}

export class PaymentsService {
  async createRecipientAccount(
    userId: string,
    data: {
      name: string;
      cpfCnpj: string;
      email: string;
      mobilePhone: string;
      incomeValue?: number;
      address?: string;
      addressNumber?: string;
      province?: string;
      postalCode?: string;
    }
  ) {
    assertNoError(
      await supabase.from("User").select("id").eq("id", userId).maybeSingle(),
      "Usuário não encontrado."
    );

    const payload = {
      name: sanitizeText(data.name, 120),
      email: data.email.trim().toLowerCase(),
      cpfCnpj: data.cpfCnpj.replace(/\D/g, ""),
      mobilePhone: sanitizePhone(data.mobilePhone),
      incomeValue: data.incomeValue,
      address: data.address,
      addressNumber: data.addressNumber,
      province: data.province,
      postalCode: data.postalCode?.replace(/\D/g, ""),
    };

    const account = await asaasRequest<{ walletId: string; id: string }>(
      "/accounts",
      {
        method: "POST",
        body: JSON.stringify(payload),
      }
    );

    const updatedUser = assertNoError(
      await supabase
        .from("User")
        .update({
          cpfCnpj: payload.cpfCnpj,
          asaasWalletId: account.walletId,
          updatedAt: new Date().toISOString(),
        })
        .eq("id", userId)
        .select(USER_PAYMENT_SELECT)
        .single()
    );

    return {
      walletId: account.walletId,
      accountId: account.id,
      user: updatedUser,
    };
  }

  private async ensureCustomer(userId: string) {
    type PaymentUser = {
      id: string;
      nome: string;
      email: string;
      telefone: string | null;
      cpfCnpj: string | null;
      asaasCustomerId: string | null;
    };

    const user = assertNoError<PaymentUser>(
      await supabase
        .from("User")
        .select("id, nome, email, telefone, cpfCnpj, asaasCustomerId")
        .eq("id", userId)
        .maybeSingle(),
      "Usuário não encontrado."
    );

    if (!user.cpfCnpj) {
      throw badRequest("CPF/CNPJ obrigatório para pagar.");
    }

    if (user.asaasCustomerId) return user.asaasCustomerId;

    const customer = await asaasRequest<{ id: string }>("/customers", {
      method: "POST",
      body: JSON.stringify({
        name: user.nome,
        email: user.email,
        cpfCnpj: String(user.cpfCnpj).replace(/\D/g, ""),
        mobilePhone: user.telefone ? sanitizePhone(user.telefone) : undefined,
      }),
    });

    await supabase
      .from("User")
      .update({
        asaasCustomerId: customer.id,
        updatedAt: new Date().toISOString(),
      })
      .eq("id", userId);

    return customer.id;
  }

  async createCheckout(contractorId: string, input: CreateCheckoutInput) {
    type ListingCheckoutRow = {
      id: string;
      userId: string;
      titulo: string;
      tipo: string;
      preco: number | null;
      aCombinar: boolean;
      status: string;
      user: {
        id: string;
        nome: string;
        email: string;
        telefone: string | null;
        asaasWalletId: string | null;
      };
    };

    const listing = assertNoError<ListingCheckoutRow>(
      await supabase
        .from("Listing")
        .select(
          `id, userId, titulo, tipo, preco, aCombinar, status,
           user:User!Listing_userId_fkey(id, nome, email, telefone, asaasWalletId)`
        )
        .eq("id", input.listingId)
        .maybeSingle(),
      "Serviço não encontrado."
    );

    const professional = listing.user;

    if (listing.tipo !== "PRODUTO") {
      throw badRequest("Pagamento só disponível para profissional disponível.");
    }
    if (listing.userId === contractorId) {
      throw badRequest("Você não pode pagar o próprio anúncio.");
    }
    if (listing.aCombinar || !listing.preco || listing.preco <= 0) {
      throw badRequest("Este serviço não possui valor fixo para checkout.");
    }
    if (!professional.asaasWalletId) {
      throw badRequest(
        "Profissional ainda não configurou conta de recebimento."
      );
    }

    const customerId = await this.ensureCustomer(contractorId);
    const amountGross = Number(listing.preco);
    const platformFee = Number((amountGross * 0.07).toFixed(2));
    const professionalNet = Number((amountGross - platformFee).toFixed(2));

    const asaasPayload: Record<string, unknown> = {
      customer: customerId,
      billingType: input.billingType,
      value: amountGross,
      dueDate: buildDueDate(1),
      description: `Papufy - ${listing.titulo}`,
      externalReference: `${listing.id}:${contractorId}`,
      split: [
        {
          walletId: professional.asaasWalletId,
          percentualValue: 93.0,
        },
      ],
    };

    if (input.billingType === "CREDIT_CARD") {
      asaasPayload.creditCard = input.creditCard;
      asaasPayload.creditCardHolderInfo = input.creditCardHolderInfo;
      asaasPayload.remoteIp = "127.0.0.1";
    }

    const asaasPayment = await asaasRequest<{
      id: string;
      status: string;
      invoiceUrl?: string;
      bankSlipUrl?: string;
      dueDate?: string;
    }>("/payments", {
      method: "POST",
      body: JSON.stringify(asaasPayload),
    });

    let pixQrCodeImage: string | undefined;
    let pixCopyPaste: string | undefined;
    if (input.billingType === "PIX") {
      const pix = await asaasRequest<{ encodedImage?: string; payload?: string }>(
        `/payments/${asaasPayment.id}/pixQrCode`,
        { expectedStatus: [200] }
      );
      pixQrCodeImage = pix.encodedImage;
      pixCopyPaste = pix.payload;
    }

    const status: TransactionStatus =
      asaasPayment.status === "RECEIVED" ? "PAID" : "PENDING";

    const transaction = assertNoError<Tables<"Transaction">>(
      await supabase
        .from("Transaction")
        .insert({
          id: newId(),
          listingId: listing.id,
          contractorId,
          professionalId: listing.userId,
          asaasPaymentId: asaasPayment.id,
          amountGross,
          platformFee,
          professionalNet,
          billingType: input.billingType,
          status,
          pixQrCodeImage: pixQrCodeImage ?? null,
          pixCopyPaste: pixCopyPaste ?? null,
          invoiceUrl: asaasPayment.invoiceUrl ?? asaasPayment.bankSlipUrl ?? null,
          paymentLink: asaasPayment.invoiceUrl ?? null,
          dueDate: asaasPayment.dueDate
            ? new Date(asaasPayment.dueDate).toISOString()
            : null,
          paidAt:
            status === "PAID" ? new Date().toISOString() : null,
          updatedAt: new Date().toISOString(),
        })
        .select()
        .single()
    );

    if (status === "PAID") {
      await supabase
        .from("Listing")
        .update({ status: "IN_PROGRESS", updatedAt: new Date().toISOString() })
        .eq("id", listing.id);
    }

    return {
      transaction,
      pix: {
        encodedImage: pixQrCodeImage,
        payload: pixCopyPaste,
      },
    };
  }

  async getTransactionStatus(transactionId: string, userId: string) {
    const tx = assertNoError<Tables<"Transaction">>(
      await supabase
        .from("Transaction")
        .select("*")
        .eq("id", transactionId)
        .maybeSingle(),
      "Transação não encontrada."
    );

    if (tx.contractorId !== userId && tx.professionalId !== userId) {
      throw forbidden("Sem permissão para esta transação.");
    }

    return tx;
  }

  async handleWebhook(payload: { event?: string; payment?: { id?: string } }) {
    const paymentId = payload.payment?.id;
    if (!paymentId) return { ignored: true };

    const { data: tx } = await supabase
      .from("Transaction")
      .select("*")
      .eq("asaasPaymentId", paymentId)
      .maybeSingle();

    if (!tx) return { ignored: true };

    if (
      payload.event === "PAYMENT_RECEIVED" ||
      payload.event === "PAYMENT_CONFIRMED"
    ) {
      await supabase
        .from("Transaction")
        .update({
          status: "PAID",
          paidAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        })
        .eq("id", tx.id);

      await supabase
        .from("Listing")
        .update({ status: "IN_PROGRESS", updatedAt: new Date().toISOString() })
        .eq("id", tx.listingId);

      return { updated: true };
    }

    if (
      payload.event === "PAYMENT_DELETED" ||
      payload.event === "PAYMENT_OVERDUE"
    ) {
      await supabase
        .from("Transaction")
        .update({
          status: "CANCELED",
          updatedAt: new Date().toISOString(),
        })
        .eq("id", tx.id);
      return { updated: true };
    }

    return { ignored: true };
  }
}

export const paymentsService = new PaymentsService();
