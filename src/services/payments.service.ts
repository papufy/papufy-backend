import { assertNoError, newId, supabase } from "../lib/db";
import {
  asaasRequest,
  asaasSubaccountRequest,
  fetchAsaasPixQrCode,
  mapAsaasPaymentStatus,
  normalizePixEncodedImage,
  type AsaasFinanceBalance,
  type AsaasPaymentResponse,
  type AsaasTransferResponse,
} from "../lib/asaasClient";
import type { Tables } from "../types/database";
import { env } from "../config/env";
import type { BillingType, TransactionStatus } from "../types/enums";
import { normalizeListingType } from "../types/enums";
import { sanitizePhone, sanitizeText } from "../utils/sanitize";
import { PaymentProfileIncompleteError } from "../errors/paymentProfile";
import { AppError, forbidden, badRequest } from "../utils/errors";
import { parseProposalFields } from "../utils/messageProposal";
import {
  buildAsaasSplit,
  normalizeCheckoutPaymentInput,
  type CheckoutPaymentInput,
  type PaymentProfilePatch,
} from "../utils/paymentCheckout";
import { publicFileUrl } from "../middleware/upload";
import {
  ensureAsaasRecipientWallet,
  getAsaasSubaccountCredentials,
} from "./asaasOnboarding.service";
import { chatService } from "./chat.service";

interface CreateCheckoutInput extends CheckoutPaymentInput {
  listingId: string;
}

type ProposalCheckoutInput = CheckoutPaymentInput;

const USER_PAYMENT_SELECT =
  "id, nome, email, telefone, cidade, uf, curriculoUrl, cpfCnpj, asaasCustomerId, asaasWalletId, createdAt, updatedAt";

const USER_ASAAS_CUSTOMER_SELECT =
  "id, nome, email, telefone, cpfCnpj, asaasCustomerId";

type AsaasCustomerUserRow = {
  id: string;
  nome: string;
  email: string;
  telefone: string | null;
  cpfCnpj: string | null;
  asaasCustomerId: string | null;
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
  ): Promise<AsaasCustomerUserRow> {
    if (!patch) {
      return assertNoError<AsaasCustomerUserRow>(
        await supabase
          .from("User")
          .select(USER_ASAAS_CUSTOMER_SELECT)
          .eq("id", userId)
          .maybeSingle(),
        "Usuário não encontrado."
      );
    }

    const update: {
      updatedAt: string;
      cpfCnpj?: string;
      telefone?: string | null;
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

    if (Object.keys(update).length <= 1) {
      return this.applyPayerProfilePatch(userId);
    }

    return assertNoError<AsaasCustomerUserRow>(
      await supabase
        .from("User")
        .update(update)
        .eq("id", userId)
        .select(USER_ASAAS_CUSTOMER_SELECT)
        .single(),
      "Usuário não encontrado."
    );
  }

  /**
   * Garante que o pagador exista no Asaas (POST /v3/customers) e retorna `cus_...`.
   * Persiste `asaasCustomerId` na tabela User na primeira cobrança (Pix ou cartão).
   */
  private async ensureAsaasCustomer(
    userId: string,
    patch?: PaymentProfilePatch
  ): Promise<string> {
    if (!env.paymentsEnabled) {
      throw badRequest(
        "Pagamentos não configurados. Defina ASAAS_API_URL e ASAAS_API_KEY no Render."
      );
    }

    try {
      const user = await this.applyPayerProfilePatch(userId, patch);

      const existingCustomerId = user.asaasCustomerId?.trim();
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

      const phone = user.telefone ? sanitizePhone(user.telefone) : undefined;

      const customer = await asaasRequest<{ id: string }>("/customers", {
        method: "POST",
        body: JSON.stringify({
          name: user.nome,
          email: user.email,
          cpfCnpj,
          mobilePhone: phone,
        }),
      });

      const asaasCustomerId = customer.id?.trim();
      if (!asaasCustomerId) {
        throw badRequest(
          "O Asaas não retornou o identificador do cliente. Tente novamente."
        );
      }

      await supabase
        .from("User")
        .update({
          asaasCustomerId,
          updatedAt: new Date().toISOString(),
        })
        .eq("id", userId);

      return asaasCustomerId;
    } catch (err) {
      if (err instanceof PaymentProfileIncompleteError) {
        throw err;
      }
      if (err instanceof AppError) {
        throw err;
      }
      const detail = err instanceof Error ? err.message : "erro desconhecido";
      throw badRequest(
        `Não foi possível registrar seu cadastro de pagamento no Asaas. ${detail}`
      );
    }
  }

  private async chargeViaAsaas(params: {
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

    const asaasCustomerId = await this.ensureAsaasCustomer(
      params.contractorUserId,
      params.payerProfile
    );

    const professionalWalletId = await ensureAsaasRecipientWallet(
      params.professionalUserId
    );

    const asaasPayload: Record<string, unknown> = {
      customer: asaasCustomerId,
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
    const amountGross = Number(amountCandidate);
    const platformFee = Number((amountGross * 0.07).toFixed(2));
    const professionalNet = Number((amountGross - platformFee).toFixed(2));

    const { asaasPayment, pixQrCodeImage, pixCopyPaste, status } =
      await this.chargeViaAsaas({
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

  private async resolvePixForTransaction(
    transaction: Tables<"Transaction">
  ): Promise<{ pixQrCodeImage?: string; pixCopyPaste?: string }> {
    if (transaction.pixCopyPaste?.trim() || transaction.pixQrCodeImage?.trim()) {
      return {
        pixQrCodeImage: transaction.pixQrCodeImage ?? undefined,
        pixCopyPaste: transaction.pixCopyPaste ?? undefined,
      };
    }

    if (!transaction.asaasPaymentId) {
      return {};
    }

    const pix = await fetchAsaasPixQrCode(transaction.asaasPaymentId);
    const pixQrCodeImage = normalizePixEncodedImage(pix.encodedImage);
    const pixCopyPaste = pix.payload?.trim() || undefined;

    if (pixQrCodeImage || pixCopyPaste) {
      await supabase
        .from("Transaction")
        .update({
          pixQrCodeImage: pixQrCodeImage ?? null,
          pixCopyPaste: pixCopyPaste ?? null,
          updatedAt: new Date().toISOString(),
        })
        .eq("id", transaction.id);
    }

    return { pixQrCodeImage, pixCopyPaste };
  }

  private async syncTransactionFromAsaas(
    tx: Tables<"Transaction">
  ): Promise<Tables<"Transaction">> {
    if (!tx.asaasPaymentId || tx.status !== "PENDING") {
      return tx;
    }

    try {
      const payment = await asaasRequest<AsaasPaymentResponse>(
        `/payments/${tx.asaasPaymentId}`
      );
      const mapped = mapAsaasPaymentStatus(payment.status);
      if (mapped !== "PAID") {
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
      Pick<Tables<"User">, "id" | "nome" | "email" | "telefone" | "asaasWalletId">
    >(
      await supabase
        .from("User")
        .select("id, nome, email, telefone, asaasWalletId")
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
        "Transação da proposta não encontrada."
      );

      const synced = await this.syncTransactionFromAsaas(existing);

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

    const { asaasPayment, pixQrCodeImage, pixCopyPaste, status } =
      await this.chargeViaAsaas({
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

    return this.syncTransactionFromAsaas(tx);
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

  /** Saldo na subconta Asaas + quanto o Papufy já liberou para saque. */
  async getSubaccountBalance(professionalId: string) {
    const { walletId, apiKey } = await getAsaasSubaccountCredentials(professionalId);
    const balance = await asaasSubaccountRequest<AsaasFinanceBalance>(
      "/finance/balance",
      apiKey,
      { expectedStatus: [200] }
    );
    const asaasBalance = Number(balance.balance ?? 0);
    const papufyWithdrawable = await this.sumReleasedNetForProfessional(professionalId);
    const maxWithdraw = Number(
      Math.min(asaasBalance, papufyWithdrawable).toFixed(2)
    );

    return {
      balance: asaasBalance,
      walletId,
      papufyWithdrawable,
      maxWithdraw,
    };
  }

  /** Saque Pix a partir do saldo da subconta Asaas (POST /transfers). */
  async requestSubaccountWithdraw(
    professionalId: string,
    input: { value: number; pixAddressKey: string }
  ) {
    const value = Number(Number(input.value).toFixed(2));
    if (!Number.isFinite(value) || value < 1) {
      throw badRequest("Informe um valor de saque válido (mínimo R$ 1,00).");
    }

    const pixAddressKey = sanitizeText(input.pixAddressKey, 120).trim();
    if (!pixAddressKey) {
      throw badRequest("Informe a chave Pix de destino.");
    }

    const papufyWithdrawable = await this.sumReleasedNetForProfessional(professionalId);
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

    const { walletId, apiKey } = await getAsaasSubaccountCredentials(professionalId);
    const asaasBalance = await asaasSubaccountRequest<AsaasFinanceBalance>(
      "/finance/balance",
      apiKey,
      { expectedStatus: [200] }
    );
    const balance = Number(asaasBalance.balance ?? 0);
    if (value > balance + 0.009) {
      throw badRequest(
        `Saldo insuficiente na subconta Asaas. Disponível: R$ ${balance.toFixed(2).replace(".", ",")}.`
      );
    }

    const transfer = await asaasSubaccountRequest<AsaasTransferResponse>(
      "/transfers",
      apiKey,
      {
        method: "POST",
        body: JSON.stringify({
          value,
          operationType: "PIX",
          pixAddressKey,
          description: `Saque Papufy — ${walletId.slice(0, 8)}`,
        }),
        expectedStatus: [200, 201],
      }
    );

    const markedTransactionIds = await this.markReleasedTransactionsWithdrawn({
      professionalId,
      withdrawAmount: value,
      transferId: transfer.id,
      pixKey: pixAddressKey,
    });

    return {
      transferId: transfer.id,
      value,
      walletId,
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

  async handleWebhook(payload: {
    event?: string;
    payment?: { id?: string };
    transfer?: { id?: string };
  }) {
    const transferId = payload.transfer?.id;
    if (transferId && payload.event?.startsWith("TRANSFER_")) {
      return { transferAcknowledged: true, transferId };
    }

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
