import { BillingType, ListingType, TransactionStatus } from "@prisma/client";
import { env } from "../config/env";
import { prisma } from "../lib/prisma";
import { sanitizePhone, sanitizeText } from "../utils/sanitize";

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
    const error = new Error(message);
    (error as Error & { statusCode: number }).statusCode = 400;
    throw error;
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
    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user) {
      const error = new Error("Usuário não encontrado.");
      (error as Error & { statusCode: number }).statusCode = 404;
      throw error;
    }

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

    const updatedUser = await prisma.user.update({
      where: { id: userId },
      data: {
        cpfCnpj: payload.cpfCnpj,
        asaasWalletId: account.walletId,
      },
      select: {
        id: true,
        nome: true,
        email: true,
        telefone: true,
        cidade: true,
        uf: true,
        curriculoUrl: true,
        cpfCnpj: true,
        asaasWalletId: true,
        createdAt: true,
        updatedAt: true,
      },
    });

    return {
      walletId: account.walletId,
      accountId: account.id,
      user: updatedUser,
    };
  }

  private async ensureCustomer(userId: string) {
    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user) {
      const error = new Error("Usuário não encontrado.");
      (error as Error & { statusCode: number }).statusCode = 404;
      throw error;
    }
    if (!user.cpfCnpj) {
      const error = new Error("CPF/CNPJ obrigatório para pagar.");
      (error as Error & { statusCode: number }).statusCode = 400;
      throw error;
    }

    if (user.asaasCustomerId) return user.asaasCustomerId;

    const customer = await asaasRequest<{ id: string }>("/customers", {
      method: "POST",
      body: JSON.stringify({
        name: user.nome,
        email: user.email,
        cpfCnpj: user.cpfCnpj.replace(/\D/g, ""),
        mobilePhone: user.telefone ? sanitizePhone(user.telefone) : undefined,
      }),
    });

    await prisma.user.update({
      where: { id: userId },
      data: { asaasCustomerId: customer.id },
    });
    return customer.id;
  }

  async createCheckout(contractorId: string, input: CreateCheckoutInput) {
    const listing = await prisma.listing.findUnique({
      where: { id: input.listingId },
      include: { user: true },
    });

    if (!listing) {
      const error = new Error("Serviço não encontrado.");
      (error as Error & { statusCode: number }).statusCode = 404;
      throw error;
    }
    if (listing.listingType !== ListingType.PROFESSIONAL_PROFILE) {
      const error = new Error("Pagamento só disponível para profissional disponível.");
      (error as Error & { statusCode: number }).statusCode = 400;
      throw error;
    }
    if (listing.userId === contractorId) {
      const error = new Error("Você não pode pagar o próprio anúncio.");
      (error as Error & { statusCode: number }).statusCode = 400;
      throw error;
    }
    if (listing.aCombinar || !listing.preco || listing.preco <= 0) {
      const error = new Error("Este serviço não possui valor fixo para checkout.");
      (error as Error & { statusCode: number }).statusCode = 400;
      throw error;
    }
    if (!listing.user.asaasWalletId) {
      const error = new Error(
        "Profissional ainda não configurou conta de recebimento."
      );
      (error as Error & { statusCode: number }).statusCode = 400;
      throw error;
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
          walletId: listing.user.asaasWalletId,
          percentualValue: 93.0,
        },
      ],
    };

    if (input.billingType === BillingType.CREDIT_CARD) {
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
    if (input.billingType === BillingType.PIX) {
      const pix = await asaasRequest<{ encodedImage?: string; payload?: string }>(
        `/payments/${asaasPayment.id}/pixQrCode`,
        { expectedStatus: [200] }
      );
      pixQrCodeImage = pix.encodedImage;
      pixCopyPaste = pix.payload;
    }

    const transaction = await prisma.transaction.create({
      data: {
        listingId: listing.id,
        contractorId,
        professionalId: listing.userId,
        asaasPaymentId: asaasPayment.id,
        amountGross,
        platformFee,
        professionalNet,
        billingType: input.billingType,
        status:
          asaasPayment.status === "RECEIVED"
            ? TransactionStatus.PAID
            : TransactionStatus.PENDING,
        pixQrCodeImage,
        pixCopyPaste,
        invoiceUrl: asaasPayment.invoiceUrl ?? asaasPayment.bankSlipUrl,
        paymentLink: asaasPayment.invoiceUrl,
        dueDate: asaasPayment.dueDate ? new Date(asaasPayment.dueDate) : undefined,
        paidAt: asaasPayment.status === "RECEIVED" ? new Date() : undefined,
      },
    });

    if (transaction.status === TransactionStatus.PAID) {
      await prisma.listing.update({
        where: { id: listing.id },
        data: { status: "IN_PROGRESS" },
      });
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
    const tx = await prisma.transaction.findUnique({
      where: { id: transactionId },
    });
    if (!tx) {
      const error = new Error("Transação não encontrada.");
      (error as Error & { statusCode: number }).statusCode = 404;
      throw error;
    }
    if (tx.contractorId !== userId && tx.professionalId !== userId) {
      const error = new Error("Sem permissão para esta transação.");
      (error as Error & { statusCode: number }).statusCode = 403;
      throw error;
    }
    return tx;
  }

  async handleWebhook(payload: { event?: string; payment?: { id?: string } }) {
    const paymentId = payload.payment?.id;
    if (!paymentId) return { ignored: true };

    const tx = await prisma.transaction.findFirst({
      where: { asaasPaymentId: paymentId },
    });
    if (!tx) return { ignored: true };

    if (payload.event === "PAYMENT_RECEIVED" || payload.event === "PAYMENT_CONFIRMED") {
      await prisma.transaction.update({
        where: { id: tx.id },
        data: { status: TransactionStatus.PAID, paidAt: new Date() },
      });
      await prisma.listing.update({
        where: { id: tx.listingId },
        data: { status: "IN_PROGRESS" },
      });
      return { updated: true };
    }

    if (payload.event === "PAYMENT_DELETED" || payload.event === "PAYMENT_OVERDUE") {
      await prisma.transaction.update({
        where: { id: tx.id },
        data: { status: TransactionStatus.CANCELED },
      });
      return { updated: true };
    }

    return { ignored: true };
  }
}

export const paymentsService = new PaymentsService();

