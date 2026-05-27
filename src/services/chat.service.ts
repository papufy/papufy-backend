import { publicFileUrl } from "../middleware/upload";
import { assertNoError, newId, supabase } from "../lib/db";
import type { Tables } from "../types/database";
import { sanitizeChatMessage } from "../utils/sanitize";
import { env } from "../config/env";
import { forbidden } from "../utils/errors";
import type { PaymentProfilePatch } from "../utils/paymentCheckout";
import { ensureAsaasRecipientWallet } from "./asaasOnboarding.service";
import { normalizeListingType } from "../types/enums";
import {
  CONTACT_VIOLATION_MESSAGE,
  containsAddressLeak,
  containsContactLeak,
} from "../utils/contactPolicy";
import {
  encodeProposalContent,
  isProposalSchemaError,
  parseProposalFields,
  type ChatMessageType,
} from "../utils/messageProposal";

const CONVERSATION_SELECT = `
  *,
  Job:Job!Conversation_jobId_fkey(id, titulo, categoria),
  Listing:Listing!Conversation_listingId_fkey(id, titulo, categoria, tipo),
  contractor:User!Conversation_contractorId_fkey(id, nome),
  provider:User!Conversation_providerId_fkey(id, nome)
`;

type ConversationRow = {
  id: string;
  jobId: string | null;
  listingId?: string | null;
  contractorId: string;
  providerId: string;
  createdAt: string;
  updatedAt: string;
  Job?: { id: string; titulo: string; categoria: string } | null;
  Listing?: {
    id: string;
    titulo: string;
    categoria: string;
    tipo: string;
  } | null;
  contractor: { id: string; nome: string };
  provider: { id: string; nome: string };
};

type MessageWithSender = Tables<"Message"> & {
  sender: { id: string; nome: string };
};

function toChatMessagePayload(
  m: MessageWithSender,
  userId: string,
  isMine?: boolean
) {
  const sender = m.sender as { id: string; nome: string };
  const parsed = parseProposalFields({
    content: m.content,
    type: m.type,
    proposalValue: m.proposalValue,
  });
  return {
    id: m.id,
    conversationId: m.conversationId,
    content: parsed.content,
    type: parsed.type,
    proposalValue: parsed.proposalValue,
    imageUrl: parsed.imageUrl,
    transactionId: m.transactionId ?? null,
    senderId: m.senderId,
    senderNome: sender.nome,
    createdAt: m.createdAt,
    isMine: isMine ?? m.senderId === userId,
  };
}

export class ChatService {
  private ensureParticipant(
    conversation: Pick<Tables<"Conversation">, "contractorId" | "providerId">,
    userId: string
  ): void {
    if (
      conversation.contractorId !== userId &&
      conversation.providerId !== userId
    ) {
      throw forbidden("Acesso negado a esta conversa.");
    }
  }

  async getOrCreateConversation(jobId: string, providerId: string) {
    const job = assertNoError<Pick<Tables<"Job">, "id" | "userId" | "titulo">>(
      await supabase
        .from("Job")
        .select("id, userId, titulo")
        .eq("id", jobId)
        .maybeSingle(),
      "Trabalho não encontrado."
    );

    if (job.userId === providerId) {
      const error = new Error("Não é possível abrir chat consigo mesmo.");
      (error as Error & { statusCode: number }).statusCode = 400;
      throw error;
    }

    const { data: existing } = await supabase
      .from("Conversation")
      .select(CONVERSATION_SELECT)
      .eq("jobId", jobId)
      .eq("providerId", providerId)
      .maybeSingle();

    if (existing) {
      return existing as ConversationRow;
    }

    return assertNoError(
      await supabase
        .from("Conversation")
        .insert({
          id: newId(),
          jobId,
          contractorId: job.userId,
          providerId,
        })
        .select(CONVERSATION_SELECT)
        .single()
    ) as ConversationRow;
  }

  async getOrCreateListingConversation(listingId: string, userId: string) {
    const listing = assertNoError<
      Pick<Tables<"Listing">, "id" | "userId" | "titulo" | "tipo">
    >(
      await supabase
        .from("Listing")
        .select("id, userId, titulo, tipo")
        .eq("id", listingId)
        .maybeSingle(),
      "Serviço não encontrado."
    );

    if (listing.userId === userId) {
      const error = new Error("Não é possível abrir chat consigo mesmo.");
      (error as Error & { statusCode: number }).statusCode = 400;
      throw error;
    }

    const { contractorId, providerId } = this.listingConversationRoles(
      listing,
      userId
    );

    const { data: existing } = await supabase
      .from("Conversation")
      .select("id, listingId, contractorId, providerId, createdAt, updatedAt")
      .eq("listingId", listingId)
      .eq("contractorId", contractorId)
      .eq("providerId", providerId)
      .maybeSingle();

    if (existing) {
      return existing;
    }

    return assertNoError(
      await supabase
        .from("Conversation")
        .insert({
          id: newId(),
          listingId,
          contractorId,
          providerId,
          jobId: null,
        })
        .select("id, listingId, contractorId, providerId, createdAt, updatedAt")
        .single()
    );
  }

  async listConversations(userId: string) {
    const conversations = assertNoError(
      await supabase
        .from("Conversation")
        .select(CONVERSATION_SELECT)
        .or(`contractorId.eq.${userId},providerId.eq.${userId}`)
        .order("updatedAt", { ascending: false })
    ) as ConversationRow[];

    const convIds = conversations.map((c) => c.id);
    const lastByConv = await this.fetchLastMessageByConversation(convIds);

    return conversations.map((c) => {
      const other =
        c.contractorId === userId ? c.provider : c.contractor;
      const last = lastByConv.get(c.id) ?? null;
      const unread =
        last && last.senderId !== userId && !last.readAt ? 1 : 0;

      return {
        id: c.id,
        jobId: c.jobId,
        listingId: c.listingId ?? undefined,
        contractorId: c.contractorId,
        providerId: c.providerId,
        myRole: c.contractorId === userId ? "contractor" : "provider",
        contextType: c.listingId ? "listing" : "job",
        listingType: c.Listing?.tipo ?? undefined,
        jobTitulo: c.Job?.titulo ?? c.Listing?.titulo ?? "Conversa",
        jobCategoria: c.Job?.categoria ?? c.Listing?.categoria ?? "Geral",
        otherUser: { id: other.id, nome: other.nome },
        lastMessage: last
          ? {
              content:
                last.type === "IMAGE"
                  ? "Imagem"
                  : last.content,
              type: last.type ?? "TEXT",
              createdAt: last.createdAt,
              isMine: last.senderId === userId,
            }
          : null,
        unread,
        updatedAt: c.updatedAt,
      };
    });
  }

  /** Uma query indexada por conversa (limit 1) — evita carregar todo o histórico. */
  private async fetchLastMessageByConversation(convIds: string[]) {
    type LastMsg = {
      id: string;
      conversationId: string;
      content: string;
      type: string;
      senderId: string;
      createdAt: string;
      readAt: string | null;
    };

    const lastByConv = new Map<string, LastMsg>();
    if (convIds.length === 0) return lastByConv;

    const chunkSize = 12;
    for (let i = 0; i < convIds.length; i += chunkSize) {
      const chunk = convIds.slice(i, i + chunkSize);
      const rows = await Promise.all(
        chunk.map(async (conversationId) => {
          const { data, error } = await supabase
            .from("Message")
            .select(
              "id, conversationId, content, type, senderId, createdAt, readAt"
            )
            .eq("conversationId", conversationId)
            .order("createdAt", { ascending: false })
            .limit(1)
            .maybeSingle();

          if (error) {
            const err = new Error(error.message);
            (err as Error & { statusCode: number }).statusCode = 500;
            throw err;
          }
          return data as LastMsg | null;
        })
      );

      for (const row of rows) {
        if (row) lastByConv.set(row.conversationId, row);
      }
    }

    return lastByConv;
  }

  async getUnreadCount(userId: string) {
    const { data: convs } = await supabase
      .from("Conversation")
      .select("id")
      .or(`contractorId.eq.${userId},providerId.eq.${userId}`);

    const convIds = convs?.map((c) => c.id) ?? [];
    if (convIds.length === 0) return 0;

    const { count, error } = await supabase
      .from("Message")
      .select("*", { count: "exact", head: true })
      .in("conversationId", convIds)
      .is("readAt", null)
      .neq("senderId", userId);

    if (error) {
      const err = new Error(error.message);
      (err as Error & { statusCode: number }).statusCode = 500;
      throw err;
    }

    return count ?? 0;
  }

  async getMessages(conversationId: string, userId: string) {
    const conversation = assertNoError<
      Pick<Tables<"Conversation">, "id" | "contractorId" | "providerId">
    >(
      await supabase
        .from("Conversation")
        .select("id, contractorId, providerId")
        .eq("id", conversationId)
        .maybeSingle(),
      "Conversa não encontrada."
    );

    this.ensureParticipant(conversation, userId);

    const { error: readError } = await supabase
      .from("Message")
      .update({ readAt: new Date().toISOString() })
      .eq("conversationId", conversationId)
      .neq("senderId", userId)
      .is("readAt", null);

    if (readError) {
      const err = new Error(readError.message);
      (err as Error & { statusCode: number }).statusCode = 500;
      throw err;
    }

    const messages = assertNoError(
      await supabase
        .from("Message")
        .select("*, sender:User!Message_senderId_fkey(id, nome)")
        .eq("conversationId", conversationId)
        .order("createdAt", { ascending: true })
    );

    return messages.map((m) =>
      toChatMessagePayload(m as MessageWithSender, userId)
    );
  }

  async sendMessage(conversationId: string, senderId: string, content: string) {
    const trimmed = sanitizeChatMessage(content);

    const conversation = assertNoError<
      Pick<
        Tables<"Conversation">,
        "id" | "contractorId" | "providerId" | "listingId"
      >
    >(
      await supabase
        .from("Conversation")
        .select("id, contractorId, providerId, listingId")
        .eq("id", conversationId)
        .maybeSingle(),
      "Conversa não encontrada."
    );

    this.ensureParticipant(conversation, senderId);

    const hasSensitiveData =
      containsContactLeak(trimmed) || containsAddressLeak(trimmed);
    if (hasSensitiveData) {
      const hasConfirmedPayment = await this.hasConfirmedPayment(conversation);
      if (!hasConfirmedPayment) {
        throw forbidden(CONTACT_VIOLATION_MESSAGE);
      }
    }

    type MessageWithSender = Tables<"Message"> & {
      sender: { id: string; nome: string };
    };

    const message = assertNoError<MessageWithSender>(
      await supabase
        .from("Message")
        .insert({
          id: newId(),
          conversationId,
          senderId,
          content: trimmed,
        })
        .select("*, sender:User!Message_senderId_fkey(id, nome)")
        .single()
    );

    const { error: updateError } = await supabase
      .from("Conversation")
      .update({ updatedAt: new Date().toISOString() })
      .eq("id", conversationId);

    if (updateError) {
      const err = new Error(updateError.message);
      (err as Error & { statusCode: number }).statusCode = 500;
      throw err;
    }

    return toChatMessagePayload(message, senderId, true);
  }

  async sendImageMessage(
    conversationId: string,
    senderId: string,
    imageFilename: string
  ) {
    const conversation = assertNoError<
      Pick<
        Tables<"Conversation">,
        "id" | "contractorId" | "providerId" | "listingId"
      >
    >(
      await supabase
        .from("Conversation")
        .select("id, contractorId, providerId, listingId")
        .eq("id", conversationId)
        .maybeSingle(),
      "Conversa não encontrada."
    );

    this.ensureParticipant(conversation, senderId);

    const imageUrl = publicFileUrl(`chat/${imageFilename}`);

    const message = assertNoError<MessageWithSender>(
      await supabase
        .from("Message")
        .insert({
          id: newId(),
          conversationId,
          senderId,
          content: "Imagem",
          type: "IMAGE",
          imageUrl,
        })
        .select("*, sender:User!Message_senderId_fkey(id, nome)")
        .single()
    );

    const { error: updateError } = await supabase
      .from("Conversation")
      .update({ updatedAt: new Date().toISOString() })
      .eq("id", conversationId);

    if (updateError) {
      const err = new Error(updateError.message);
      (err as Error & { statusCode: number }).statusCode = 500;
      throw err;
    }

    return toChatMessagePayload(message, senderId, true);
  }

  async sendSystemMessage(conversationId: string, content: string) {
    const conversation = assertNoError<
      Pick<Tables<"Conversation">, "id" | "contractorId" | "providerId">
    >(
      await supabase
        .from("Conversation")
        .select("id, contractorId, providerId")
        .eq("id", conversationId)
        .maybeSingle(),
      "Conversa não encontrada."
    );
    const message = assertNoError<MessageWithSender>(
      await supabase
        .from("Message")
        .insert({
          id: newId(),
          conversationId,
          senderId: conversation.contractorId,
          content: sanitizeChatMessage(content),
          type: "SYSTEM",
        })
        .select("*, sender:User!Message_senderId_fkey(id, nome)")
        .single()
    );
    await supabase
      .from("Conversation")
      .update({ updatedAt: new Date().toISOString() })
      .eq("id", conversationId);
    return {
      id: message.id,
      conversationId: message.conversationId,
      content: message.content,
      type: "SYSTEM" as const,
      proposalValue: null,
      transactionId: null,
      senderId: message.senderId,
      senderNome: (message.sender as { nome: string }).nome,
      createdAt: message.createdAt,
      isMine: false,
    };
  }

  private listingConversationRoles(
    listing: Pick<Tables<"Listing">, "userId" | "tipo">,
    userId: string
  ): { contractorId: string; providerId: string } {
    const tipo = normalizeListingType(listing.tipo) ?? listing.tipo;
    if (tipo === "JOB_VACANCY") {
      return { contractorId: listing.userId, providerId: userId };
    }
    return { contractorId: userId, providerId: listing.userId };
  }

  async createProposal(
    conversationId: string,
    senderId: string,
    value: number,
    receiverProfile?: PaymentProfilePatch
  ) {
    const conversation = assertNoError<
      Pick<Tables<"Conversation">, "id" | "contractorId" | "providerId" | "listingId">
    >(
      await supabase
        .from("Conversation")
        .select("id, contractorId, providerId, listingId")
        .eq("id", conversationId)
        .maybeSingle(),
      "Conversa não encontrada."
    );
    this.ensureParticipant(conversation, senderId);
    if (!conversation.listingId) {
      throw forbidden("Proposta disponível apenas para conversa de anúncio.");
    }
    const listing = assertNoError<
      Pick<Tables<"Listing">, "id" | "tipo">
    >(
      await supabase
        .from("Listing")
        .select("id, tipo")
        .eq("id", conversation.listingId)
        .maybeSingle(),
      "Anúncio não encontrado."
    );
    const listingType = normalizeListingType(listing.tipo) ?? listing.tipo;
    if (listingType !== "JOB_VACANCY") {
      throw forbidden(
        "Proposta por chat é só para pedidos de serviço. Use o pagamento no anúncio."
      );
    }
    if (senderId !== conversation.providerId) {
      throw forbidden("Somente quem executa o serviço pode enviar proposta.");
    }

    if (env.paymentsEnabled) {
      await ensureAsaasRecipientWallet(senderId, receiverProfile);
    }

    const displayContent = `Proposta de serviço enviada: R$ ${value.toFixed(2)}`;
    const messageId = newId();
    const baseInsert = {
      id: messageId,
      conversationId,
      senderId,
    };

    let insertResult = await supabase
      .from("Message")
      .insert({
        ...baseInsert,
        content: displayContent,
        type: "PROPOSAL",
        proposalValue: value,
      })
      .select("*, sender:User!Message_senderId_fkey(id, nome)")
      .single();

    if (
      insertResult.error &&
      isProposalSchemaError(insertResult.error.message)
    ) {
      insertResult = await supabase
        .from("Message")
        .insert({
          ...baseInsert,
          content: encodeProposalContent(value, displayContent),
        })
        .select("*, sender:User!Message_senderId_fkey(id, nome)")
        .single();
    }

    const message = assertNoError<MessageWithSender>(insertResult);
    await supabase
      .from("Conversation")
      .update({ updatedAt: new Date().toISOString() })
      .eq("id", conversationId);

    return toChatMessagePayload(message, senderId, true);
  }

  async assertParticipant(conversationId: string, userId: string) {
    const { data: conversation } = await supabase
      .from("Conversation")
      .select("id, contractorId, providerId")
      .eq("id", conversationId)
      .maybeSingle();

    if (!conversation) return null;
    try {
      this.ensureParticipant(conversation, userId);
    } catch {
      return null;
    }
    return conversation;
  }

  private async hasConfirmedPayment(
    conversation: Pick<
      Tables<"Conversation">,
      "listingId" | "contractorId" | "providerId"
    >
  ): Promise<boolean> {
    if (!conversation.listingId) return false;

    const { data, error } = await supabase
      .from("Transaction")
      .select("id")
      .eq("listingId", conversation.listingId)
      .eq("contractorId", conversation.contractorId)
      .eq("professionalId", conversation.providerId)
      .eq("status", "PAID")
      .limit(1)
      .maybeSingle();

    if (error) return false;
    return Boolean(data?.id);
  }
}

export const chatService = new ChatService();
