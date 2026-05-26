import { assertNoError, newId, supabase } from "../lib/db";
import type { Tables } from "../types/database";
import { sanitizeChatMessage } from "../utils/sanitize";
import { forbidden } from "../utils/errors";

const CONVERSATION_SELECT = `
  *,
  Job!Conversation_jobId_fkey(id, titulo, categoria),
  contractor:User!Conversation_contractorId_fkey(id, nome),
  provider:User!Conversation_providerId_fkey(id, nome)
`;

type ConversationRow = {
  id: string;
  jobId: string;
  contractorId: string;
  providerId: string;
  createdAt: string;
  updatedAt: string;
  Job: { id: string; titulo: string; categoria: string };
  contractor: { id: string; nome: string };
  provider: { id: string; nome: string };
};

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

  async listConversations(userId: string) {
    const conversations = assertNoError(
      await supabase
        .from("Conversation")
        .select(CONVERSATION_SELECT)
        .or(`contractorId.eq.${userId},providerId.eq.${userId}`)
        .order("updatedAt", { ascending: false })
    ) as ConversationRow[];

    const convIds = conversations.map((c) => c.id);
    const lastByConv = new Map<
      string,
      {
        id: string;
        content: string;
        senderId: string;
        createdAt: string;
        readAt: string | null;
      }
    >();

    if (convIds.length > 0) {
      const messages = assertNoError(
        await supabase
          .from("Message")
          .select("id, conversationId, content, senderId, createdAt, readAt")
          .in("conversationId", convIds)
          .order("createdAt", { ascending: false })
      );

      for (const m of messages) {
        if (!lastByConv.has(m.conversationId)) {
          lastByConv.set(m.conversationId, m);
        }
      }
    }

    return conversations.map((c) => {
      const other =
        c.contractorId === userId ? c.provider : c.contractor;
      const last = lastByConv.get(c.id) ?? null;
      const unread =
        last && last.senderId !== userId && !last.readAt ? 1 : 0;

      return {
        id: c.id,
        jobId: c.jobId,
        jobTitulo: c.Job.titulo,
        jobCategoria: c.Job.categoria,
        otherUser: { id: other.id, nome: other.nome },
        lastMessage: last
          ? {
              content: last.content,
              createdAt: last.createdAt,
              isMine: last.senderId === userId,
            }
          : null,
        unread,
        updatedAt: c.updatedAt,
      };
    });
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

    return messages.map((m) => {
      const sender = m.sender as { id: string; nome: string };
      return {
        id: m.id,
        conversationId: m.conversationId,
        content: m.content,
        senderId: m.senderId,
        senderNome: sender.nome,
        createdAt: m.createdAt,
        isMine: m.senderId === userId,
      };
    });
  }

  async sendMessage(conversationId: string, senderId: string, content: string) {
    const trimmed = sanitizeChatMessage(content);

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

    this.ensureParticipant(conversation, senderId);

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

    return {
      id: message.id,
      conversationId: message.conversationId,
      content: message.content,
      senderId: message.senderId,
      senderNome: message.sender.nome,
      createdAt: message.createdAt,
      isMine: true,
    };
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
}

export const chatService = new ChatService();
