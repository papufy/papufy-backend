import { assertNoError, newId, supabase } from "../lib/db";
import type { Tables } from "../types/database";
import { env } from "../config/env";
import type { BillingType, TransactionStatus } from "../types/enums";
import { normalizeListingType } from "../types/enums";
import { sanitizePhone, sanitizeText } from "../utils/sanitize";
import {
  parseBirthDateInput,
  isValidBirthDate,
} from "../utils/birthDate";
import { PaymentProfileIncompleteError } from "../errors/paymentProfile";
import { AppError, forbidden, badRequest } from "../utils/errors";
import { parseProposalFields } from "../utils/messageProposal";
import {
  normalizeCheckoutPaymentInput,
  type CheckoutPaymentInput,
  type PaymentProfilePatch,
} from "../utils/paymentCheckout";
import { publicFileUrl } from "../middleware/upload";
import { chatService } from "./chat.service";
import { listingsService } from "./listings.service";
import { getPaymentProvider } from "../payments/provider";
import { pagarmeProvider } from "../payments/pagarmeProvider";
import { LISTING_RENEWAL_PRICE_BRL } from "../constants/listingTtl";

interface CreateCheckoutInput extends CheckoutPaymentInput {
  listingId: string;
}

type ProposalCheckoutInput = CheckoutPaymentInput;

const USER_PAYMENT_SELECT =
  "id, nome, email, telefone, cidade, uf, curriculoUrl, cpfCnpj, pagarmeCustomerId, pagarmeRecipientId, paymentProvider, createdAt, updatedAt";

const USER_PAYER_SELECT =
  "id, nome, email, telefone, cpfCnpj, dataNascimento, pagarmeCustomerId, paymentProvider";

type PayerUserRow = {
  id: string;
  nome: string;
  email: string;
  telefone: string | null;
  cpfCnpj: string | null;
  dataNascimento: string | null;
  pagarmeCustomerId: string | null;
  paymentProvider: string | null;
};

type UnifiedChargeResult = {
  paymentProvider: "pagarme";
  /** ID principal para sync/webhook (Pagar.me charge id) */
  paymentId: string;
  pagarmeOrderId: string | null;
  pagarmeChargeId: string | null;
  pixQrCodeImage?: string;
  pixCopyPaste?: string;
  status: TransactionStatus;
  invoiceUrl?: string | null;
  paymentLink?: string | null;
  dueDate?: string | null;
};

function buildDueDate(daysAhead = 1): string {
  const date = new Date();
  date.setDate(date.getDate() + daysAhead);
  return date.toISOString().slice(0, 10);
}

export class PaymentsService {
  private digitsOnly(value: string): string {
    return value.replace(/\D/g, "");
  }

  /**
   * Atualiza dados do pagador no User (Supabase / schema Prisma) antes do primeiro checkout.
   */
  private async applyPayerProfilePatch(
    userId: string,
    patch?: PaymentProfilePatch
  ): Promise<PayerUserRow> {
    if (!patch) {
      return assertNoError<PayerUserRow>(
        await supabase
          .from("User")
          .select(USER_PAYER_SELECT)
          .eq("id", userId)
          .maybeSingle(),
        "Usuário não encontrado."
      );
    }

    const update: {
      updatedAt: string;
      cpfCnpj?: string;
      telefone?: string | null;
      dataNascimento?: string | null;
    } = {
      updatedAt: new Date().toISOString(),
    };

    if (patch.cpfCnpj !== undefined) {
      const doc = this.digitsOnly(patch.cpfCnpj);
      if (doc.length !== 11 && doc.length !== 14) {
        throw badRequest("CPF ou CNPJ inválido. Verifique os dígitos informados.");
      }
      update.cpfCnpj = doc;
    }

    if (patch.telefone !== undefined) {
      const phone = this.digitsOnly(patch.telefone);
      if (phone.length < 10) {
        throw badRequest("Telefone inválido. Informe DDD + número.");
      }
      update.telefone = sanitizePhone(patch.telefone);
    }

    if (patch.dataNascimento !== undefined) {
      const birthDate = parseBirthDateInput(patch.dataNascimento);
      if (!isValidBirthDate(birthDate)) {
        throw badRequest("Data de nascimento inválida. Informe uma data válida (18+ anos).");
      }
      update.dataNascimento = birthDate;
    }

    if (Object.keys(update).length <= 1) {
      return this.applyPayerProfilePatch(userId);
    }

    return assertNoError<PayerUserRow>(
      await supabase
        .from("User")
        .update(update)
        .eq("id", userId)
        .select(USER_PAYER_SELECT)
        .single(),
      "Usuário não encontrado."
    );
  }

  /**
   * Garante customer no Pagar.me e persiste o id no User.
   */
  private async ensurePspCustomer(
    userId: string,
    patch?: PaymentProfilePatch
  ): Promise<string> {
    if (!env.paymentsEnabled || !env.paymentProvider) {
      throw badRequest(
        "Pagamentos temporariamente indisponíveis. Tente novamente em instantes."
      );
    }

    try {
      const user = await this.applyPayerProfilePatch(userId, patch);

      const existingCustomerId = user.pagarmeCustomerId?.trim();
      if (existingCustomerId) {
        return existingCustomerId;
      }

      const cpfCnpj = user.cpfCnpj ? this.digitsOnly(user.cpfCnpj) : "";
      if (cpfCnpj.length < 11) {
        throw new PaymentProfileIncompleteError(
          ["cpfCnpj"],
          "payer",
          "Informe CPF ou CNPJ válido para concluir o pagamento."
        );
      }

      if (cpfCnpj.length === 11 && !user.dataNascimento) {
        throw new PaymentProfileIncompleteError(
          ["dataNascimento"],
          "payer",
          "Informe a data de nascimento para concluir o pagamento."
        );
      }

      const provider = getPaymentProvider();
      const { customerId } = await provider.ensureCustomer({
        userId,
        nome: user.nome,
        email: user.email,
        cpfCnpj,
        telefone: user.telefone,
        dataNascimento: user.dataNascimento,
      });

      await supabase
        .from("User")
        .update({
          pagarmeCustomerId: customerId,
          paymentProvider: "pagarme",
          updatedAt: new Date().toISOString(),
        })
        .eq("id", userId);

      return customerId;
    } catch (err) {
      if (err instanceof PaymentProfileIncompleteError) {
        throw err;
      }
      if (err instanceof AppError) {
        throw err;
      }
      const detail = err instanceof Error ? err.message : "erro desconhecido";
      throw badRequest(
        `Não foi possível registrar seu cadastro de pagamento. ${detail}`
      );
    }
  }

  /** Recebedor do profissional no Pagar.me (recipient). */
  private async ensurePspRecipient(professionalUserId: string): Promise<string> {
    const user = assertNoError<{
      id: string;
      nome: string;
      email: string;
      telefone: string | null;
      cpfCnpj: string | null;
      dataNascimento: string | null;
      pagarmeRecipientId: string | null;
    }>(
      await supabase
        .from("User")
        .select(
          "id, nome, email, telefone, cpfCnpj, dataNascimento, pagarmeRecipientId"
        )
        .eq("id", professionalUserId)
        .maybeSingle(),
      "Profissional não encontrado."
    );

    if (user.pagarmeRecipientId?.trim()) {
      return user.pagarmeRecipientId.trim();
    }

    const cpfCnpj = user.cpfCnpj ? this.digitsOnly(user.cpfCnpj) : "";
    if (cpfCnpj.length < 11) {
      throw new PaymentProfileIncompleteError(
        ["cpfCnpj"],
        "receiver",
        "O profissional precisa completar CPF/CNPJ e dados bancários para receber pagamentos."
      );
    }

    throw new PaymentProfileIncompleteError(
      ["bankAccount"],
      "receiver",
      "O profissional precisa cadastrar a conta bancária na Carteira antes de receber pagamentos."
    );
  }

  private async chargeViaActiveProvider(params: {
    contractorUserId: string;
    payerProfile?: PaymentProfilePatch;
    professionalUserId: string;
    billingType: BillingType;
    amountGross: number;
    description: string;
    externalReference: string;
    creditCard?: CheckoutPaymentInput["creditCard"];
    creditCardHolderInfo?: CheckoutPaymentInput["creditCardHolderInfo"];
    remoteIp?: string;
  }): Promise<UnifiedChargeResult> {
    let normalized: ReturnType<typeof normalizeCheckoutPaymentInput>;
    try {
      normalized = normalizeCheckoutPaymentInput({
        billingType: params.billingType,
        creditCard: params.creditCard,
        creditCardHolderInfo: params.creditCardHolderInfo,
        remoteIp: params.remoteIp,
      });
    } catch (err) {
      throw badRequest(
        err instanceof Error ? err.message : "Dados de pagamento inválidos."
      );
    }

    if (!env.paymentProvider) {
      throw badRequest(
        "Pagamentos temporariamente indisponíveis. Tente novamente em instantes."
      );
    }

    const customerId = await this.ensurePspCustomer(
      params.contractorUserId,
      params.payerProfile
    );
    const professionalRecipientId = await this.ensurePspRecipient(
      params.professionalUserId
    );

    const provider = getPaymentProvider();
    const amountCents = Math.round(params.amountGross * 100);
    const charge = await provider.chargeWithSplit({
      billingType: normalized.billingType,
      creditCard: normalized.creditCard,
      creditCardHolderInfo: normalized.creditCardHolderInfo,
      remoteIp: normalized.remoteIp,
      customerId,
      professionalRecipientId,
      amountCents,
      description: params.description,
      externalReference: params.externalReference,
    });

    const status: TransactionStatus =
      charge.status === "PAID"
        ? "PAID"
        : charge.status === "CANCELED"
          ? "CANCELED"
          : charge.status === "FAILED"
            ? "CANCELED"
            : "PENDING";

    const raw = charge.raw as { id?: string; charges?: { id?: string }[] } | undefined;
    const orderId = raw?.id ?? null;
    const chargeId = raw?.charges?.[0]?.id ?? charge.paymentId;
    return {
      paymentProvider: "pagarme",
      paymentId: chargeId,
      pagarmeOrderId: orderId,
      pagarmeChargeId: chargeId,
      pixQrCodeImage: charge.pixQrCodeImage ?? undefined,
      pixCopyPaste: charge.pixCopyPaste ?? undefined,
      status,
      invoiceUrl: charge.invoiceUrl ?? null,
      paymentLink: charge.invoiceUrl ?? null,
      dueDate: charge.dueDate ?? buildDueDate(1),
    };
  }

  private async createPaymentForListing(
    contractorId: string,
    input: CreateCheckoutInput,
    amountOverride?: number
  ) {
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
      };
    };

    const listing = assertNoError<ListingCheckoutRow>(
      await supabase
        .from("Listing")
        .select(
          `id, userId, titulo, tipo, preco, aCombinar, status,
           user:User!Listing_userId_fkey(id, nome, email, telefone)`
        )
        .eq("id", input.listingId)
        .maybeSingle(),
      "Serviço não encontrado."
    );

    const professional = listing.user;

    const listingType = normalizeListingType(listing.tipo) ?? listing.tipo;
    if (listingType !== "PROFESSIONAL_PROFILE") {
      throw badRequest(
        "Pagamento direto só está disponível em anúncios de profissionais."
      );
    }
    if (listing.userId === contractorId) {
      throw badRequest("Você não pode pagar o próprio anúncio.");
    }
    const amountCandidate = amountOverride ?? listing.preco;
    if (!amountCandidate || amountCandidate <= 0 || listing.aCombinar) {
      throw badRequest(
        "Este serviço não tem um valor fechado para pagamento. Combine o valor pelo chat."
      );
    }
    const amountGross = Number(amountCandidate);
    const platformFee = Number((amountGross * 0.07).toFixed(2));
    const professionalNet = Number((amountGross - platformFee).toFixed(2));

    const charge = await this.chargeViaActiveProvider({
      contractorUserId: contractorId,
      payerProfile: input.payerProfile,
      billingType: input.billingType,
      amountGross,
      description: `Papufy - ${listing.titulo}`,
      externalReference: `${listing.id}:${contractorId}`,
      professionalUserId: professional.id,
      creditCard: input.creditCard,
      creditCardHolderInfo: input.creditCardHolderInfo,
      remoteIp: input.remoteIp,
    });

    const transaction = assertNoError<Tables<"Transaction">>(
      await supabase
        .from("Transaction")
        .insert({
          id: newId(),
          listingId: listing.id,
          contractorId,
          professionalId: listing.userId,
          pagarmeOrderId: charge.pagarmeOrderId,
          pagarmeChargeId: charge.pagarmeChargeId,
          paymentProvider: "pagarme",
          amountGross,
          platformFee,
          professionalNet,
          billingType: input.billingType,
          status: charge.status,
          pixQrCodeImage: charge.pixQrCodeImage ?? null,
          pixCopyPaste: charge.pixCopyPaste ?? null,
          invoiceUrl: charge.invoiceUrl ?? null,
          paymentLink: charge.paymentLink ?? null,
          dueDate: charge.dueDate
            ? new Date(charge.dueDate).toISOString()
            : null,
          paidAt: charge.status === "PAID" ? new Date().toISOString() : null,
          updatedAt: new Date().toISOString(),
        })
        .select()
        .single()
    );

    if (charge.status === "PAID") {
      await supabase
        .from("Listing")
        .update({ status: "IN_PROGRESS", updatedAt: new Date().toISOString() })
        .eq("id", listing.id);
    }

    return {
      transaction,
      pix: {
        encodedImage: charge.pixQrCodeImage,
        payload: charge.pixCopyPaste,
      },
    };
  }

  /** Onboarding do recebedor — Pagar.me (register_information + conta bancária). */
  async createRecipientAccount(
    userId: string,
    data: {
      name: string;
      cpfCnpj: string;
      email: string;
      mobilePhone: string;
      dataNascimento?: string;
      motherName?: string;
      professionalOccupation?: string;
      /** Renda mensal em reais (convertida para centavos na API) */
      incomeValue?: number;
      bankAccount: {
        holderName: string;
        holderType: "individual" | "company";
        holderDocument: string;
        bank: string;
        branchNumber: string;
        branchCheckDigit?: string;
        accountNumber: string;
        accountCheckDigit: string;
        type: "checking" | "savings";
      };
      recipientAddress: {
        street: string;
        streetNumber: string;
        complementary?: string;
        neighborhood: string;
        city: string;
        state: string;
        zipCode: string;
        referencePoint?: string;
      };
    }
  ) {
    const updateUser: {
      nome: string;
      cpfCnpj: string;
      telefone: string | null;
      updatedAt: string;
      dataNascimento?: string;
      cidade?: string;
      uf?: string;
    } = {
      nome: sanitizeText(data.name, 120),
      cpfCnpj: data.cpfCnpj.replace(/\D/g, ""),
      telefone: sanitizePhone(data.mobilePhone),
      updatedAt: new Date().toISOString(),
    };
    if (data.dataNascimento) {
      const birthDate = parseBirthDateInput(data.dataNascimento);
      if (!isValidBirthDate(birthDate)) {
        throw badRequest("Data de nascimento inválida.");
      }
      updateUser.dataNascimento = birthDate;
    }
    if (data.recipientAddress.city) {
      updateUser.cidade = sanitizeText(data.recipientAddress.city, 80);
    }
    if (data.recipientAddress.state) {
      updateUser.uf = data.recipientAddress.state.trim().toUpperCase().slice(0, 2);
    }

    await supabase.from("User").update(updateUser).eq("id", userId);

    const userRow = assertNoError<{
      pagarmeRecipientId: string | null;
      dataNascimento: string | null;
    }>(
      await supabase
        .from("User")
        .select("pagarmeRecipientId, dataNascimento")
        .eq("id", userId)
        .maybeSingle(),
      "Usuário não encontrado."
    );

    const provider = getPaymentProvider();
    const monthlyIncomeCents = data.incomeValue
      ? Math.round(data.incomeValue * 100)
      : 300_000;

    const recipient = await provider.ensureRecipient({
      userId,
      nome: data.name,
      email: data.email,
      cpfCnpj: data.cpfCnpj,
      telefone: data.mobilePhone,
      dataNascimento: userRow.dataNascimento ?? data.dataNascimento,
      motherName: data.motherName,
      professionalOccupation: data.professionalOccupation,
      monthlyIncomeCents,
      bankAccount: data.bankAccount,
      address: data.recipientAddress,
      existingRecipientId: userRow.pagarmeRecipientId,
    });

    await supabase
      .from("User")
      .update({
        pagarmeRecipientId: recipient.recipientId,
        paymentProvider: "pagarme",
        updatedAt: new Date().toISOString(),
      })
      .eq("id", userId);

    const updatedUser = assertNoError(
      await supabase
        .from("User")
        .select(USER_PAYMENT_SELECT)
        .eq("id", userId)
        .single()
    );

    return {
      walletId: recipient.recipientId,
      accountId: recipient.recipientId,
      recipientId: recipient.recipientId,
      status: recipient.status,
      provider: "pagarme" as const,
      user: updatedUser,
    };
  }

  async createCheckout(contractorId: string, input: CreateCheckoutInput) {
    return this.createPaymentForListing(contractorId, input);
  }

  private async resolvePixForTransaction(
    transaction: Tables<"Transaction">
  ): Promise<{ pixQrCodeImage?: string; pixCopyPaste?: string }> {
    return {
      pixQrCodeImage: transaction.pixQrCodeImage ?? undefined,
      pixCopyPaste: transaction.pixCopyPaste ?? undefined,
    };
  }

  private async syncTransactionFromPsp(
    tx: Tables<"Transaction">
  ): Promise<Tables<"Transaction">> {
    if (tx.status !== "PENDING") {
      return tx;
    }

    const paymentId =
      tx.pagarmeChargeId?.trim() || tx.pagarmeOrderId?.trim();

    if (!paymentId) {
      return tx;
    }

    try {
      const { status } = await pagarmeProvider.getPaymentStatus(paymentId);
      if (status !== "PAID") {
        return tx;
      }

      return assertNoError<Tables<"Transaction">>(
        await supabase
          .from("Transaction")
          .update({
            status: "PAID",
            paidAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
          })
          .eq("id", tx.id)
          .select()
          .single()
      );
    } catch {
      return tx;
    }
  }

  async createCheckoutFromProposal(
    contractorId: string,
    messageId: string,
    input: ProposalCheckoutInput
  ) {
    const proposal = assertNoError<
      Pick<
        Tables<"Message">,
        | "id"
        | "conversationId"
        | "senderId"
        | "proposalValue"
        | "type"
        | "content"
        | "transactionId"
      >
    >(
      await supabase
        .from("Message")
        .select(
          "id, conversationId, senderId, proposalValue, type, content, transactionId"
        )
        .eq("id", messageId)
        .maybeSingle(),
      "Proposta não encontrada."
    );
    const parsedProposal = parseProposalFields({
      content: proposal.content,
      type: proposal.type,
      proposalValue: proposal.proposalValue,
    });
    if (parsedProposal.type !== "PROPOSAL" || !parsedProposal.proposalValue) {
      throw badRequest("Mensagem não é uma proposta válida.");
    }
    const conversation = assertNoError<
      Pick<Tables<"Conversation">, "id" | "listingId" | "contractorId" | "providerId">
    >(
      await supabase
        .from("Conversation")
        .select("id, listingId, contractorId, providerId")
        .eq("id", proposal.conversationId)
        .maybeSingle(),
      "Conversa não encontrada."
    );
    if (!conversation.listingId) {
      throw badRequest("Proposta não vinculada a anúncio.");
    }

    const listing = assertNoError<
      Pick<Tables<"Listing">, "id" | "userId" | "titulo">
    >(
      await supabase
        .from("Listing")
        .select("id, userId, titulo")
        .eq("id", conversation.listingId)
        .maybeSingle(),
      "Anúncio não encontrado."
    );
    if (contractorId !== conversation.contractorId) {
      throw forbidden("Somente o contratante pode pagar esta proposta.");
    }
    if (proposal.senderId !== conversation.providerId) {
      throw badRequest("Proposta inválida para esta conversa.");
    }

    const professional = assertNoError<
      Pick<Tables<"User">, "id" | "nome" | "email" | "telefone">
    >(
      await supabase
        .from("User")
        .select("id, nome, email, telefone")
        .eq("id", proposal.senderId)
        .maybeSingle(),
      "Profissional não encontrado."
    );
    if (proposal.transactionId) {
      const existing = assertNoError<Tables<"Transaction">>(
        await supabase
          .from("Transaction")
          .select("*")
          .eq("id", proposal.transactionId)
          .maybeSingle(),
        "Pagamento da proposta não encontrado."
      );

      const synced = await this.syncTransactionFromPsp(existing);

      if (synced.status === "PAID" || synced.status === "RELEASED") {
        throw badRequest("Esta proposta já foi paga.");
      }
      if (synced.status === "IN_DISPUTE") {
        throw badRequest("Este pagamento está em mediação pelo suporte.");
      }

      if (synced.status === "PENDING") {
        if (input.billingType === "CREDIT_CARD") {
          throw badRequest(
            "Já existe uma cobrança Pix pendente. Pague o Pix ou aguarde antes de usar cartão."
          );
        }

        const pix = await this.resolvePixForTransaction(synced);
        const refreshed = assertNoError<Tables<"Transaction">>(
          await supabase
            .from("Transaction")
            .select("*")
            .eq("id", synced.id)
            .single()
        );

        return {
          transaction: refreshed,
          pix: {
            encodedImage: pix.pixQrCodeImage ?? refreshed.pixQrCodeImage ?? undefined,
            payload: pix.pixCopyPaste ?? refreshed.pixCopyPaste ?? undefined,
          },
        };
      }
    }

    const amountGross = Number(parsedProposal.proposalValue);
    const platformFee = Number((amountGross * 0.07).toFixed(2));
    const professionalNet = Number((amountGross - platformFee).toFixed(2));

    const charge = await this.chargeViaActiveProvider({
      contractorUserId: contractorId,
      payerProfile: input.payerProfile,
      billingType: input.billingType,
      amountGross,
      description: `Papufy - ${listing.titulo}`,
      externalReference: `${listing.id}:${contractorId}:${proposal.id}`,
      professionalUserId: professional.id,
      creditCard: input.creditCard,
      creditCardHolderInfo: input.creditCardHolderInfo,
      remoteIp: input.remoteIp,
    });

    const transaction = assertNoError<Tables<"Transaction">>(
      await supabase
        .from("Transaction")
        .insert({
          id: newId(),
          listingId: listing.id,
          contractorId,
          professionalId: professional.id,
          pagarmeOrderId: charge.pagarmeOrderId,
          pagarmeChargeId: charge.pagarmeChargeId,
          paymentProvider: "pagarme",
          amountGross,
          platformFee,
          professionalNet,
          billingType: input.billingType,
          status: charge.status,
          pixQrCodeImage: charge.pixQrCodeImage ?? null,
          pixCopyPaste: charge.pixCopyPaste ?? null,
          invoiceUrl: charge.invoiceUrl ?? null,
          paymentLink: charge.paymentLink ?? null,
          dueDate: charge.dueDate
            ? new Date(charge.dueDate).toISOString()
            : null,
          paidAt: charge.status === "PAID" ? new Date().toISOString() : null,
          updatedAt: new Date().toISOString(),
        })
        .select()
        .single()
    );

    await supabase
      .from("Message")
      .update({ transactionId: transaction.id })
      .eq("id", messageId);
    if (charge.status === "PAID") {
      await supabase
        .from("Listing")
        .update({ status: "IN_PROGRESS", updatedAt: new Date().toISOString() })
        .eq("id", listing.id);
    }

    return {
      transaction,
      pix: {
        encodedImage: charge.pixQrCodeImage,
        payload: charge.pixCopyPaste,
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
      "Pagamento não encontrado."
    );

    if (tx.contractorId !== userId && tx.professionalId !== userId) {
      throw forbidden("Sem permissão para este pagamento.");
    }

    return this.syncTransactionFromPsp(tx);
  }

  async listMyTransactions(userId: string) {
    const transactions = assertNoError(
      await supabase
        .from("Transaction")
        .select(
          `*,
           listing:Listing!Transaction_listingId_fkey(id, titulo),
           contractor:User!Transaction_contractorId_fkey(id, nome),
           professional:User!Transaction_professionalId_fkey(id, nome)`
        )
        .or(`contractorId.eq.${userId},professionalId.eq.${userId}`)
        .order("createdAt", { ascending: false })
    );
    return { transactions };
  }

  async getWalletSummary(userId: string) {
    const { transactions } = await this.listMyTransactions(userId);

    let availableBalance = 0;
    let pendingReceive = 0;
    let pendingPay = 0;
    let totalWithdrawn = 0;

    for (const tx of transactions) {
      if (tx.professionalId === userId) {
        const net = Number(tx.professionalNet);
        if (tx.status === "RELEASED") {
          availableBalance += net;
        } else if (
          tx.status === "PENDING" ||
          tx.status === "PAID" ||
          tx.status === "IN_DISPUTE"
        ) {
          pendingReceive += net;
        } else if (tx.status === "WITHDRAWN") {
          totalWithdrawn += net;
        }
      }

      if (tx.contractorId === userId && tx.status === "PENDING") {
        pendingPay += Number(tx.amountGross);
      }
    }

    return {
      availableBalance: Number(availableBalance.toFixed(2)),
      pendingReceive: Number(pendingReceive.toFixed(2)),
      pendingPay: Number(pendingPay.toFixed(2)),
      totalWithdrawn: Number(totalWithdrawn.toFixed(2)),
    };
  }

  /** Soma líquida das transações RELEASED (liberadas no Papufy) ainda não sacadas. */
  private async sumReleasedNetForProfessional(professionalId: string): Promise<number> {
    const { data } = await supabase
      .from("Transaction")
      .select("professionalNet")
      .eq("professionalId", professionalId)
      .eq("status", "RELEASED");

    const total = (data ?? []).reduce(
      (sum, row) => sum + Number(row.professionalNet),
      0
    );
    return Number(total.toFixed(2));
  }

  /**
   * Marca transações RELEASED como WITHDRAWN (FIFO) até cobrir o valor sacado.
   */
  private async markReleasedTransactionsWithdrawn(input: {
    professionalId: string;
    withdrawAmount: number;
    transferId: string;
    pixKey: string;
  }): Promise<string[]> {
    const { data: rows } = await supabase
      .from("Transaction")
      .select("id, professionalNet")
      .eq("professionalId", input.professionalId)
      .eq("status", "RELEASED")
      .order("releasedAt", { ascending: true });

    let remaining = input.withdrawAmount;
    const markedIds: string[] = [];
    const now = new Date().toISOString();

    for (const row of rows ?? []) {
      if (remaining < 0.01) break;
      const net = Number(row.professionalNet);
      if (net > remaining + 0.009) break;

      await supabase
        .from("Transaction")
        .update({
          status: "WITHDRAWN",
          withdrawnAt: now,
          withdrawPixKey: sanitizeText(input.pixKey, 120),
          withdrawTransferId: input.transferId,
          updatedAt: now,
        })
        .eq("id", row.id);

      markedIds.push(row.id);
      remaining = Number((remaining - net).toFixed(2));
    }

    return markedIds;
  }

  /** Saldo Pagar.me + liberado no Papufy (saque = min dos dois). */
  async getSubaccountBalance(professionalId: string) {
    const user = assertNoError<{ pagarmeRecipientId: string | null }>(
      await supabase
        .from("User")
        .select("pagarmeRecipientId")
        .eq("id", professionalId)
        .maybeSingle(),
      "Usuário não encontrado."
    );

    const recipientId = user.pagarmeRecipientId?.trim() || null;
    const papufyWithdrawable =
      await this.sumReleasedNetForProfessional(professionalId);

    if (!recipientId) {
      return {
        balance: 0,
        walletId: null as string | null,
        papufyWithdrawable,
        maxWithdraw: 0,
        waitingFunds: 0,
        needsOnboarding: true,
      };
    }

    const pspBalance = await pagarmeProvider.getBalance({ recipientId });
    const maxWithdraw = Number(
      Math.min(pspBalance.available, papufyWithdrawable).toFixed(2)
    );

    return {
      balance: pspBalance.available,
      walletId: recipientId,
      papufyWithdrawable,
      maxWithdraw,
      waitingFunds: pspBalance.waitingFunds ?? 0,
      needsOnboarding: false,
    };
  }

  /**
   * Saque: transferência Pagar.me para a conta bancária do recipient
   * + marca RELEASED → WITHDRAWN no Papufy.
   */
  async requestSubaccountWithdraw(
    professionalId: string,
    input: { value: number; pixAddressKey?: string }
  ) {
    const value = Number(Number(input.value).toFixed(2));
    if (!Number.isFinite(value) || value < 1) {
      throw badRequest("Informe um valor de saque válido (mínimo R$ 1,00).");
    }

    const user = assertNoError<{ pagarmeRecipientId: string | null }>(
      await supabase
        .from("User")
        .select("pagarmeRecipientId")
        .eq("id", professionalId)
        .maybeSingle(),
      "Usuário não encontrado."
    );

    const recipientId = user.pagarmeRecipientId?.trim();
    if (!recipientId) {
      throw badRequest(
        "Cadastre sua conta bancária antes de solicitar saque."
      );
    }

    const papufyWithdrawable =
      await this.sumReleasedNetForProfessional(professionalId);
    if (papufyWithdrawable < 1) {
      throw badRequest(
        "Nenhum valor liberado no Papufy para saque. Confirme a conclusão do serviço com o cliente em cada pagamento."
      );
    }
    if (value > papufyWithdrawable + 0.009) {
      throw badRequest(
        `Valor acima do liberado no Papufy (R$ ${papufyWithdrawable.toFixed(2).replace(".", ",")}).`
      );
    }

    const pspBalance = await pagarmeProvider.getBalance({ recipientId });
    if (value > pspBalance.available + 0.009) {
      throw badRequest(
        `Saldo insuficiente para saque. Disponível: R$ ${pspBalance.available.toFixed(2).replace(".", ",")}.`
      );
    }

    const transfer = await pagarmeProvider.withdraw({
      value,
      recipientId,
    });

    const pixKeyNote =
      input.pixAddressKey?.trim() ||
      `bank-transfer:${recipientId.slice(0, 12)}`;

    const markedTransactionIds = await this.markReleasedTransactionsWithdrawn({
      professionalId,
      withdrawAmount: value,
      transferId: transfer.transferId,
      pixKey: pixKeyNote,
    });

    return {
      transferId: transfer.transferId,
      value,
      walletId: recipientId,
      status: transfer.status ?? "PENDING",
      markedTransactionIds,
      papufyWithdrawableBefore: papufyWithdrawable,
    };
  }

  async confirmCompletion(transactionId: string, userId: string) {
    const tx = assertNoError<Tables<"Transaction">>(
      await supabase
        .from("Transaction")
        .select("*")
        .eq("id", transactionId)
        .maybeSingle(),
      "Pagamento não encontrado."
    );
    if (tx.contractorId !== userId && tx.professionalId !== userId) {
      throw forbidden("Sem permissão para confirmar este pagamento.");
    }
    if (tx.status !== "PAID" && tx.status !== "RELEASED") {
      throw badRequest("Ainda não é possível confirmar este pagamento.");
    }

    const patch: Partial<Tables<"Transaction">> = {
      updatedAt: new Date().toISOString(),
    };
    if (tx.contractorId === userId && !tx.contractorConfirmedAt) {
      patch.contractorConfirmedAt = new Date().toISOString();
    }
    if (tx.professionalId === userId && !tx.professionalConfirmedAt) {
      patch.professionalConfirmedAt = new Date().toISOString();
    }

    const updated = assertNoError<Tables<"Transaction">>(
      await supabase
        .from("Transaction")
        .update(patch)
        .eq("id", transactionId)
        .select("*")
        .single()
    );

    let finalTx = updated;
    if (updated.contractorConfirmedAt && updated.professionalConfirmedAt) {
      finalTx = assertNoError<Tables<"Transaction">>(
        await supabase
          .from("Transaction")
          .update({
            status: "RELEASED",
            releasedAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
          })
          .eq("id", transactionId)
          .select("*")
          .single()
      );

      const conversation = await supabase
        .from("Conversation")
        .select("id")
        .eq("listingId", tx.listingId)
        .eq("contractorId", tx.contractorId)
        .eq("providerId", tx.professionalId)
        .maybeSingle();
      if (conversation.data?.id) {
        await chatService.sendSystemMessage(
          conversation.data.id,
          "Ambas as partes confirmaram o serviço. Pagamento liberado para saque do profissional."
        );
      }
    }

    return { transaction: finalTx };
  }

  async createListingRenewal(
    userId: string,
    listingId: string,
    payerProfile?: PaymentProfilePatch
  ) {
    const listing = assertNoError<
      Pick<Tables<"Listing">, "id" | "userId" | "titulo" | "archivedAt">
    >(
      await supabase
        .from("Listing")
        .select("id, userId, titulo, archivedAt")
        .eq("id", listingId)
        .maybeSingle(),
      "Anúncio não encontrado."
    );

    if (listing.archivedAt) {
      throw badRequest("Este anúncio não pode mais ser renovado.");
    }
    if (listing.userId !== userId) {
      throw forbidden("Somente o dono pode renovar este anúncio.");
    }

    const amountGross = LISTING_RENEWAL_PRICE_BRL;
    const customerId = await this.ensurePspCustomer(userId, payerProfile);
    const provider = getPaymentProvider();
    const amountCents = Math.round(amountGross * 100);
    const externalReference = `renew:${listing.id}:${userId}`.slice(0, 52);

    const charge = await provider.chargePlatformOnly({
      customerId,
      amountCents,
      description: `Papufy — renovação 15 dias: ${listing.titulo}`.slice(
        0,
        256
      ),
      externalReference,
      billingType: "PIX",
    });

    const status: TransactionStatus =
      charge.status === "PAID"
        ? "PAID"
        : charge.status === "CANCELED" || charge.status === "FAILED"
          ? "CANCELED"
          : "PENDING";

    const raw = charge.raw as
      | { id?: string; charges?: { id?: string }[] }
      | undefined;
    const orderId = raw?.id ?? null;
    const chargeId = raw?.charges?.[0]?.id ?? charge.paymentId;

    const renewal = assertNoError<Tables<"ListingRenewal">>(
      await supabase
        .from("ListingRenewal")
        .insert({
          id: newId(),
          listingId: listing.id,
          userId,
          pagarmeOrderId: orderId,
          pagarmeChargeId: chargeId,
          paymentProvider: "pagarme",
          amountGross,
          billingType: "PIX",
          status,
          pixQrCodeImage: charge.pixQrCodeImage ?? null,
          pixCopyPaste: charge.pixCopyPaste ?? null,
          paidAt: status === "PAID" ? new Date().toISOString() : null,
          updatedAt: new Date().toISOString(),
        })
        .select()
        .single()
    );

    if (status === "PAID") {
      await listingsService.applyPaidRenewal(listing.id);
    }

    return {
      renewal,
      pix: {
        encodedImage: charge.pixQrCodeImage,
        payload: charge.pixCopyPaste,
      },
    };
  }

  async getListingRenewalStatus(renewalId: string, userId: string) {
    let renewal = assertNoError<Tables<"ListingRenewal">>(
      await supabase
        .from("ListingRenewal")
        .select("*")
        .eq("id", renewalId)
        .maybeSingle(),
      "Renovação não encontrada."
    );

    if (renewal.userId !== userId) {
      throw forbidden("Sem permissão para esta renovação.");
    }

    if (renewal.status === "PENDING") {
      const paymentId =
        renewal.pagarmeChargeId?.trim() || renewal.pagarmeOrderId?.trim();
      if (paymentId) {
        try {
          const { status } = await pagarmeProvider.getPaymentStatus(paymentId);
          if (status === "PAID") {
            renewal = assertNoError<Tables<"ListingRenewal">>(
              await supabase
                .from("ListingRenewal")
                .update({
                  status: "PAID",
                  paidAt: new Date().toISOString(),
                  updatedAt: new Date().toISOString(),
                })
                .eq("id", renewal.id)
                .select()
                .single()
            );
            await listingsService.applyPaidRenewal(renewal.listingId);
          }
        } catch {
          /* mantém PENDING */
        }
      }
    }

    return { renewal };
  }

  async handleWebhook(payload: Record<string, unknown>) {
    // Pagar.me: { type: "charge.paid", data: { id, ... } }
    const pagarmeType =
      typeof payload.type === "string" ? payload.type : undefined;
    const pagarmeData =
      payload.data && typeof payload.data === "object"
        ? (payload.data as Record<string, unknown>)
        : undefined;
    const pagarmeChargeId =
      typeof pagarmeData?.id === "string" ? pagarmeData.id : undefined;

    if (!pagarmeType || !pagarmeChargeId) {
      return { ignored: true };
    }

    const { data: renewal } = await supabase
      .from("ListingRenewal")
      .select("*")
      .or(
        `pagarmeChargeId.eq.${pagarmeChargeId},pagarmeOrderId.eq.${pagarmeChargeId}`
      )
      .maybeSingle();

    if (renewal) {
      if (
        pagarmeType === "charge.paid" ||
        pagarmeType === "order.paid" ||
        pagarmeType === "charge.captured"
      ) {
        if (renewal.status !== "PAID") {
          await supabase
            .from("ListingRenewal")
            .update({
              status: "PAID",
              paidAt: new Date().toISOString(),
              updatedAt: new Date().toISOString(),
            })
            .eq("id", renewal.id);
          await listingsService.applyPaidRenewal(renewal.listingId);
        }
        return { updated: true, kind: "listing_renewal", provider: "pagarme" };
      }

      if (
        pagarmeType === "charge.payment_failed" ||
        pagarmeType === "charge.canceled" ||
        pagarmeType === "order.canceled"
      ) {
        await supabase
          .from("ListingRenewal")
          .update({
            status: "CANCELED",
            updatedAt: new Date().toISOString(),
          })
          .eq("id", renewal.id);
        return { updated: true, kind: "listing_renewal", provider: "pagarme" };
      }

      return { ignored: true, kind: "listing_renewal", provider: "pagarme" };
    }

    const { data: tx } = await supabase
      .from("Transaction")
      .select("*")
      .or(
        `pagarmeChargeId.eq.${pagarmeChargeId},pagarmeOrderId.eq.${pagarmeChargeId}`
      )
      .maybeSingle();

    if (!tx) return { ignored: true };

    if (
      pagarmeType === "charge.paid" ||
      pagarmeType === "order.paid" ||
      pagarmeType === "charge.captured"
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
        .update({
          status: "IN_PROGRESS",
          updatedAt: new Date().toISOString(),
        })
        .eq("id", tx.listingId);

      const conversation = await supabase
        .from("Conversation")
        .select("id")
        .eq("listingId", tx.listingId)
        .eq("contractorId", tx.contractorId)
        .eq("providerId", tx.professionalId)
        .maybeSingle();
      if (conversation.data?.id) {
        await chatService.sendSystemMessage(
          conversation.data.id,
          "Pagamento confirmado. Serviço em andamento."
        );
      }
      return { updated: true, provider: "pagarme" };
    }

    if (
      pagarmeType === "charge.payment_failed" ||
      pagarmeType === "charge.canceled" ||
      pagarmeType === "order.canceled"
    ) {
      await supabase
        .from("Transaction")
        .update({
          status: "CANCELED",
          updatedAt: new Date().toISOString(),
        })
        .eq("id", tx.id);
      return { updated: true, provider: "pagarme" };
    }

    return { ignored: true, provider: "pagarme" };
  }

  async reportTransactionProblem(input: {
    transactionId: string;
    reporterId: string;
    descricao: string;
    comprovanteFilename?: string;
  }) {
    const tx = assertNoError<Tables<"Transaction">>(
      await supabase
        .from("Transaction")
        .select("*")
        .eq("id", input.transactionId)
        .maybeSingle(),
      "Pagamento não encontrado."
    );
    if (tx.status !== "PAID") {
      throw badRequest("Só é possível reportar após confirmação de pagamento.");
    }
    if (tx.professionalId !== input.reporterId) {
      throw forbidden("Somente o profissional pode abrir disputa.");
    }

    const conversation = await supabase
      .from("Conversation")
      .select("id")
      .eq("listingId", tx.listingId)
      .eq("contractorId", tx.contractorId)
      .eq("providerId", tx.professionalId)
      .maybeSingle();

    const ticket = assertNoError(
      await supabase
        .from("SupportTicket")
        .insert({
          id: newId(),
          transactionId: tx.id,
          conversationId: conversation.data?.id ?? null,
          reporterId: input.reporterId,
          descricao: sanitizeText(input.descricao, 2000),
          comprovanteUrl: input.comprovanteFilename
            ? publicFileUrl(`support/${input.comprovanteFilename}`)
            : null,
          status: "ABERTO",
          updatedAt: new Date().toISOString(),
        })
        .select()
        .single()
    );

    await supabase
      .from("Transaction")
      .update({ status: "IN_DISPUTE", updatedAt: new Date().toISOString() })
      .eq("id", tx.id);

    if (conversation.data?.id) {
      await chatService.sendSystemMessage(
        conversation.data.id,
        "A negociação entrou em mediação do suporte. Aguarde análise da equipe Papufy."
      );
    }

    return { ticket };
  }
}

export const paymentsService = new PaymentsService();
