import { assertNoError, newId, supabase } from "../lib/db";
import {
  asaasRequest,
  fetchAsaasPixQrCode,
  mapAsaasPaymentStatus,
  normalizePixEncodedImage,
  type AsaasPaymentResponse,
} from "../lib/asaasClient";
import type { Tables } from "../types/database";
import { env } from "../config/env";
import type { BillingType, TransactionStatus } from "../types/enums";
import { normalizeListingType } from "../types/enums";
import { sanitizePhone, sanitizeText } from "../utils/sanitize";
import { forbidden, badRequest } from "../utils/errors";
import { parseProposalFields } from "../utils/messageProposal";
import {
  buildAsaasSplit,
  normalizeCheckoutPaymentInput,
  type CheckoutPaymentInput,
} from "../utils/paymentCheckout";
import { publicFileUrl } from "../middleware/upload";
import {
  ensureAsaasCustomer,
  ensureAsaasRecipientWallet,
} from "./asaasOnboarding.service";
import { chatService } from "./chat.service";

interface CreateCheckoutInput extends CheckoutPaymentInput {
  listingId: string;
}

type ProposalCheckoutInput = CheckoutPaymentInput;

const USER_PAYMENT_SELECT =
  "id, nome, email, telefone, cidade, uf, curriculoUrl, cpfCnpj, asaasCustomerId, asaasWalletId, createdAt, updatedAt";

function buildDueDate(daysAhead = 1): string {
  const date = new Date();
  date.setDate(date.getDate() + daysAhead);
  return date.toISOString().slice(0, 10);
}

export class PaymentsService {
  private async chargeViaAsaas(params: {
    customerId: string;
    professionalUserId: string;
    billingType: BillingType;
    amountGross: number;
    description: string;
    externalReference: string;
    creditCard?: CheckoutPaymentInput["creditCard"];
    creditCardHolderInfo?: CheckoutPaymentInput["creditCardHolderInfo"];
    remoteIp?: string;
  }): Promise<{
    asaasPayment: AsaasPaymentResponse;
    pixQrCodeImage?: string;
    pixCopyPaste?: string;
    status: TransactionStatus;
  }> {
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

    const professionalWalletId = await ensureAsaasRecipientWallet(
      params.professionalUserId
    );

    const asaasPayload: Record<string, unknown> = {
      customer: params.customerId,
      billingType: normalized.billingType,
      value: params.amountGross,
      dueDate: buildDueDate(1),
      description: params.description,
      externalReference: params.externalReference,
      split: buildAsaasSplit(professionalWalletId),
    };

    if (normalized.billingType === "CREDIT_CARD") {
      asaasPayload.creditCard = normalized.creditCard;
      asaasPayload.creditCardHolderInfo = normalized.creditCardHolderInfo;
      asaasPayload.remoteIp = normalized.remoteIp;
    }

    const asaasPayment = await asaasRequest<AsaasPaymentResponse>("/payments", {
      method: "POST",
      body: JSON.stringify(asaasPayload),
    });

    let pixQrCodeImage: string | undefined;
    let pixCopyPaste: string | undefined;
    if (normalized.billingType === "PIX") {
      const pix = await fetchAsaasPixQrCode(asaasPayment.id);
      pixQrCodeImage = normalizePixEncodedImage(pix.encodedImage);
      pixCopyPaste = pix.payload?.trim() || undefined;
      if (!pixCopyPaste && !pixQrCodeImage) {
        throw badRequest(
          "Cobrança Pix criada, mas o QR Code ainda não está disponível. Tente novamente em instantes."
        );
      }
    }

    return {
      asaasPayment,
      pixQrCodeImage,
      pixCopyPaste,
      status: mapAsaasPaymentStatus(asaasPayment.status),
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

    const listingType = normalizeListingType(listing.tipo) ?? listing.tipo;
    if (listingType !== "PROFESSIONAL_PROFILE") {
      throw badRequest(
        "Pagamento direto só está disponível para perfil profissional."
      );
    }
    if (listing.userId === contractorId) {
      throw badRequest("Você não pode pagar o próprio anúncio.");
    }
    const amountCandidate = amountOverride ?? listing.preco;
    if (!amountCandidate || amountCandidate <= 0 || listing.aCombinar) {
      throw badRequest("Este serviço não possui valor fixo para checkout.");
    }
    const customerId = await ensureAsaasCustomer(
      contractorId,
      input.payerProfile
    );
    const amountGross = Number(amountCandidate);
    const platformFee = Number((amountGross * 0.07).toFixed(2));
    const professionalNet = Number((amountGross - platformFee).toFixed(2));

    const { asaasPayment, pixQrCodeImage, pixCopyPaste, status } =
      await this.chargeViaAsaas({
        customerId,
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
          paidAt: status === "PAID" ? new Date().toISOString() : null,
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

  /** Mantido por compatibilidade — delega ao onboarding automático. */
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
    await supabase
      .from("User")
      .update({
        nome: sanitizeText(data.name, 120),
        cpfCnpj: data.cpfCnpj.replace(/\D/g, ""),
        telefone: sanitizePhone(data.mobilePhone),
        updatedAt: new Date().toISOString(),
      })
      .eq("id", userId);

    const walletId = await ensureAsaasRecipientWallet(userId, {
      cpfCnpj: data.cpfCnpj,
      telefone: data.mobilePhone,
    });

    const updatedUser = assertNoError(
      await supabase
        .from("User")
        .select(USER_PAYMENT_SELECT)
        .eq("id", userId)
        .single()
    );

    return {
      walletId,
      accountId: walletId,
      user: updatedUser,
    };
  }

  async createCheckout(contractorId: string, input: CreateCheckoutInput) {
    return this.createPaymentForListing(contractorId, input);
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
      >
    >(
      await supabase
        .from("Message")
        .select("id, conversationId, senderId, proposalValue, type, content")
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
      Pick<Tables<"User">, "id" | "nome" | "email" | "telefone" | "asaasWalletId">
    >(
      await supabase
        .from("User")
        .select("id, nome, email, telefone, asaasWalletId")
        .eq("id", proposal.senderId)
        .maybeSingle(),
      "Profissional não encontrado."
    );
    const customerId = await ensureAsaasCustomer(
      contractorId,
      input.payerProfile
    );
    const amountGross = Number(parsedProposal.proposalValue);
    const platformFee = Number((amountGross * 0.07).toFixed(2));
    const professionalNet = Number((amountGross - platformFee).toFixed(2));

    const { asaasPayment, pixQrCodeImage, pixCopyPaste, status } =
      await this.chargeViaAsaas({
        customerId,
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
          paidAt: status === "PAID" ? new Date().toISOString() : null,
          updatedAt: new Date().toISOString(),
        })
        .select()
        .single()
    );

    await supabase
      .from("Message")
      .update({ transactionId: transaction.id })
      .eq("id", messageId);
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

  async confirmCompletion(transactionId: string, userId: string) {
    const tx = assertNoError<Tables<"Transaction">>(
      await supabase
        .from("Transaction")
        .select("*")
        .eq("id", transactionId)
        .maybeSingle(),
      "Transação não encontrada."
    );
    if (tx.contractorId !== userId && tx.professionalId !== userId) {
      throw forbidden("Sem permissão para confirmar esta transação.");
    }
    if (tx.status !== "PAID" && tx.status !== "RELEASED") {
      throw badRequest("Transação ainda não está apta para confirmação.");
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

  async withdrawViaPix(input: {
    transactionId: string;
    professionalId: string;
    pixKey: string;
  }) {
    const tx = assertNoError<Tables<"Transaction">>(
      await supabase
        .from("Transaction")
        .select("*")
        .eq("id", input.transactionId)
        .maybeSingle(),
      "Transação não encontrada."
    );
    if (tx.professionalId !== input.professionalId) {
      throw forbidden("Somente o profissional pode sacar esta transação.");
    }
    if (tx.status !== "RELEASED") {
      throw badRequest("Saque disponível apenas para pagamentos liberados.");
    }
    if (tx.withdrawnAt) {
      throw badRequest("Esta transação já foi sacada.");
    }

    const transfer = await asaasRequest<{ id: string }>("/transfers", {
      method: "POST",
      body: JSON.stringify({
        value: tx.professionalNet,
        operationType: "PIX",
        pixAddressKey: input.pixKey,
        description: `Saque Papufy ${tx.id}`,
      }),
      expectedStatus: [200, 201],
    });

    const updated = assertNoError<Tables<"Transaction">>(
      await supabase
        .from("Transaction")
        .update({
          status: "WITHDRAWN",
          withdrawnAt: new Date().toISOString(),
          withdrawPixKey: sanitizeText(input.pixKey, 120),
          withdrawTransferId: transfer.id,
          updatedAt: new Date().toISOString(),
        })
        .eq("id", tx.id)
        .select("*")
        .single()
    );

    return { transaction: updated, transferId: transfer.id };
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
      "Transação não encontrada."
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
