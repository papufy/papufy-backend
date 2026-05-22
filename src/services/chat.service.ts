import { prisma } from "../lib/prisma";

export class ChatService {
  async getOrCreateConversation(jobId: string, providerId: string) {
    const job = await prisma.job.findUnique({
      where: { id: jobId },
      select: { id: true, userId: true, titulo: true },
    });

    if (!job) {
      const error = new Error("Trabalho não encontrado.");
      (error as Error & { statusCode: number }).statusCode = 404;
      throw error;
    }

    if (job.userId === providerId) {
      const error = new Error("Não é possível abrir chat consigo mesmo.");
      (error as Error & { statusCode: number }).statusCode = 400;
      throw error;
    }

    const conversation = await prisma.conversation.upsert({
      where: {
        jobId_providerId: { jobId, providerId },
      },
      create: {
        jobId,
        contractorId: job.userId,
        providerId,
      },
      update: {},
      include: {
        job: { select: { id: true, titulo: true, categoria: true } },
        contractor: { select: { id: true, nome: true } },
        provider: { select: { id: true, nome: true } },
      },
    });

    return conversation;
  }

  async listConversations(userId: string) {
    const conversations = await prisma.conversation.findMany({
      where: {
        OR: [{ contractorId: userId }, { providerId: userId }],
      },
      orderBy: { updatedAt: "desc" },
      include: {
        job: { select: { id: true, titulo: true, categoria: true } },
        contractor: { select: { id: true, nome: true } },
        provider: { select: { id: true, nome: true } },
        messages: {
          orderBy: { createdAt: "desc" },
          take: 1,
          select: {
            id: true,
            content: true,
            senderId: true,
            createdAt: true,
            readAt: true,
          },
        },
      },
    });

    return conversations.map((c) => {
      const other =
        c.contractorId === userId ? c.provider : c.contractor;
      const last = c.messages[0] ?? null;
      const unread =
        last && last.senderId !== userId && !last.readAt ? 1 : 0;

      return {
        id: c.id,
        jobId: c.jobId,
        jobTitulo: c.job.titulo,
        jobCategoria: c.job.categoria,
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
    return prisma.message.count({
      where: {
        readAt: null,
        senderId: { not: userId },
        conversation: {
          OR: [{ contractorId: userId }, { providerId: userId }],
        },
      },
    });
  }

  async getMessages(conversationId: string, userId: string) {
    const conversation = await prisma.conversation.findUnique({
      where: { id: conversationId },
    });

    if (!conversation) {
      const error = new Error("Conversa não encontrada.");
      (error as Error & { statusCode: number }).statusCode = 404;
      throw error;
    }

    if (
      conversation.contractorId !== userId &&
      conversation.providerId !== userId
    ) {
      const error = new Error("Acesso negado a esta conversa.");
      (error as Error & { statusCode: number }).statusCode = 403;
      throw error;
    }

    await prisma.message.updateMany({
      where: {
        conversationId,
        senderId: { not: userId },
        readAt: null,
      },
      data: { readAt: new Date() },
    });

    const messages = await prisma.message.findMany({
      where: { conversationId },
      orderBy: { createdAt: "asc" },
      include: {
        sender: { select: { id: true, nome: true } },
      },
    });

    return messages.map((m) => ({
      id: m.id,
      conversationId: m.conversationId,
      content: m.content,
      senderId: m.senderId,
      senderNome: m.sender.nome,
      createdAt: m.createdAt,
      isMine: m.senderId === userId,
    }));
  }

  async sendMessage(conversationId: string, senderId: string, content: string) {
    const trimmed = content
      .replace(/<[^>]*>/g, "")
      .trim()
      .slice(0, 2000);
    if (!trimmed) {
      const error = new Error("Mensagem vazia.");
      (error as Error & { statusCode: number }).statusCode = 400;
      throw error;
    }

    const conversation = await prisma.conversation.findUnique({
      where: { id: conversationId },
    });

    if (!conversation) {
      const error = new Error("Conversa não encontrada.");
      (error as Error & { statusCode: number }).statusCode = 404;
      throw error;
    }

    if (
      conversation.contractorId !== senderId &&
      conversation.providerId !== senderId
    ) {
      const error = new Error("Acesso negado a esta conversa.");
      (error as Error & { statusCode: number }).statusCode = 403;
      throw error;
    }

    const message = await prisma.message.create({
      data: {
        conversationId,
        senderId,
        content: trimmed,
      },
      include: {
        sender: { select: { id: true, nome: true } },
      },
    });

    await prisma.conversation.update({
      where: { id: conversationId },
      data: { updatedAt: new Date() },
    });

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
    const conversation = await prisma.conversation.findUnique({
      where: { id: conversationId },
    });

    if (!conversation) return null;
    if (
      conversation.contractorId !== userId &&
      conversation.providerId !== userId
    ) {
      return null;
    }
    return conversation;
  }
}

export const chatService = new ChatService();
