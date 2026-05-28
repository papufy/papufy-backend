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

type ConversationBaseRow = {
  id: string;
  jobId: string | null;
  listingId: string | null;
  contractorId: string;
  providerId: string;
  createdAt: string;
  updatedAt: string;
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
    let conversations: ConversationRow[] = [];
    try {
      conversations = assertNoError(
        await supabase
          .from("Conversation")
          .select(CONVERSATION_SELECT)
          .or(`contractorId.eq.${userId},providerId.eq.${userId}`)
          .order("updatedAt", { ascending: false })
      ) as ConversationRow[];
    } catch {
      // Fallback para ambientes onde joins nomeados (FK aliases) divergem do schema atual.
      conversations = await this.listConversationsFallback(userId);
    }

    const convIds = conversations.map((c) => c.id);
    const [lastByConv, unreadByConv] = await Promise.all([
      this.fetchLastMessageByConversation(convIds),
      this.fetchUnreadCountByConversation(userId, convIds),
    ]);

    return conversations.map((c) => {
      const fallbackContractor = { id: c.contractorId, nome: "Usuário" };
      const fallbackProvider = { id: c.providerId, nome: "Usuário" };
      const contractor = c.contractor ?? fallbackContractor;
      const provider = c.provider ?? fallbackProvider;
      const other = c.contractorId === userId ? provider : contractor;
      const last = lastByConv.get(c.id) ?? null;
      const unread = unreadByConv.get(c.id) ?? 0;
      const parsedLast = last
        ? parseProposalFields({
            content: last.content,
            type: last.type as ChatMessageType,
            proposalValue: null,
          })
        : null;

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
        otherUser: { id: other.id, nome: other.nome || "Usuário" },
        lastMessage: last
          ? {
              content: parsedLast?.type === "IMAGE" ? "Imagem" : parsedLast?.content ?? "",
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

  private async listConversationsFallback(userId: string): Promise<ConversationRow[]> {
    const baseRows = assertNoError<ConversationBaseRow[]>(
      await supabase
        .from("Conversation")
        .select("id, jobId, listingId, contractorId, providerId, createdAt, updatedAt")
        .or(`contractorId.eq.${userId},providerId.eq.${userId}`)
        .order("updatedAt", { ascending: false })
    );

    if (baseRows.length === 0) return [];

    const userIds = Array.from(
      new Set(baseRows.flatMap((row) => [row.contractorId, row.providerId]))
    );
    const jobIds = Array.from(
      new Set(
        baseRows.map((row) => row.jobId).filter((id): id is string => Boolean(id))
      )
    );
    const listingIds = Array.from(
      new Set(
        baseRows
          .map((row) => row.listingId)
          .filter((id): id is string => Boolean(id))
      )
    );

    const [users, jobs, listings] = await Promise.all([
      userIds.length
        ? this.safeSelect<Array<Pick<Tables<"User">, "id" | "nome">>>(
            supabase.from("User").select("id, nome").in("id", userIds)
          )
        : Promise.resolve([]),
      jobIds.length
        ? this.safeSelect<Array<Pick<Tables<"Job">, "id" | "titulo" | "categoria">>>(
            supabase.from("Job").select("id, titulo, categoria").in("id", jobIds)
          )
        : Promise.resolve([]),
      listingIds.length
        ? this.safeSelect<
            Array<Pick<Tables<"Listing">, "id" | "titulo" | "categoria" | "tipo">>
          >(
            supabase
              .from("Listing")
              .select("id, titulo, categoria, tipo")
              .in("id", listingIds)
          )
        : Promise.resolve([]),
    ]);

    const userById = new Map(users.map((u) => [u.id, u]));
    const jobById = new Map(jobs.map((j) => [j.id, j]));
    const listingById = new Map(listings.map((l) => [l.id, l]));

    return baseRows.map((row) => {
      const contractor = userById.get(row.contractorId) ?? {
        id: row.contractorId,
        nome: "Usuário",
      };
      const provider = userById.get(row.providerId) ?? {
        id: row.providerId,
        nome: "Usuário",
      };
      const job = row.jobId ? jobById.get(row.jobId) : null;
      const listing = row.listingId ? listingById.get(row.listingId) : null;

      return {
        ...row,
        listingId: row.listingId ?? undefined,
        Job: job
          ? { id: job.id, titulo: job.titulo, categoria: job.categoria }
          : null,
        Listing: listing
          ? {
              id: listing.id,
              titulo: listing.titulo,
              categoria: listing.categoria,
              tipo: listing.tipo,
            }
          : null,
        contractor: { id: contractor.id, nome: contractor.nome },
        provider: { id: provider.id, nome: provider.nome },
      } as ConversationRow;
    });
  }

  private async fetchUnreadCountByConversation(userId: string, convIds: string[]) {
    const unreadByConv = new Map<string, number>();
    if (convIds.length === 0) return unreadByConv;

    const { data } = await supabase
      .from("Message")
      .select("conversationId")
      .in("conversationId", convIds)
      .is("readAt", null)
      .neq("senderId", userId);

    for (const row of data ?? []) {
      const conversationId = row.conversationId as string;
      unreadByConv.set(conversationId, (unreadByConv.get(conversationId) ?? 0) + 1);
    }

    return unreadByConv;
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

          if (error) return null;
          return data as LastMsg | null;
        })
      );

      for (const row of rows) {
        if (row) lastByConv.set(row.conversationId, row);
      }
    }

    return lastByConv;
  }

  private async safeSelect<T>(
    query: PromiseLike<{ data: T | null; error: { message: string } | null }>
  ): Promise<T extends Array<infer _Item> ? T : never> {
    const result = await query;
    if (result.error || !result.data) {
      return [] as T extends Array<infer _Item> ? T : never;
    }
    return result.data as T extends Array<infer _Item> ? T : never;
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
