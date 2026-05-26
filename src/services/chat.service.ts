import { prisma } from "../lib/prisma";

function detectContactLeak(content: string): string | null {
  const text = content.toLowerCase();
  const digits = content.replace(/\D/g, "");

  // Phones: BR patterns / long digit sequences
  const looksLikePhone =
    digits.length >= 10 ||
    /\b\(?\d{2}\)?\s?\d{4,5}-?\d{4}\b/.test(text) ||
    /\b\d{4,5}-\d{4}\b/.test(text);

  if (looksLikePhone) return "Não é permitido compartilhar telefone no chat.";

  // Email / social / external contact
  if (/\b\S+@\S+\.\S+\b/.test(text))
    return "Não é permitido compartilhar e-mail no chat.";
  if (/\b(whatsapp|wpp|wa\.me|instagram|insta|facebook|telegram|t\.me)\b/.test(text))
    return "Não é permitido compartilhar contatos externos no chat.";

  // Address heuristics (keywords + numbers)
  const addressKeywords =
    /\b(rua|avenida|av\.|travessa|bairro|cep|nº|numero|número|complemento|apto|apartamento|casa|condom[ií]nio)\b/;
  if (addressKeywords.test(text) && /\d/.test(text))
    return "Não é permitido compartilhar endereço no chat.";

  return null;
}

export class ChatService {
  async getOrCreateConversation(jobId: string, providerId: string) {
    const job = await prisma.job.findUnique({
      where: { id: jobId },
      select: { id: true, userId: true, titulo: true },
    });

    if (!job) {
      const error = new Error("Serviço não encontrado.");
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

  async getOrCreateListingConversation(listingId: string, userId: string) {
    const listing = await prisma.listing.findUnique({
      where: { id: listingId },
      select: { id: true, userId: true, titulo: true, listingType: true },
    });

    if (!listing) {
      const error = new Error("Serviço não encontrado.");
      (error as Error & { statusCode: number }).statusCode = 404;
      throw error;
    }

    if (listing.userId === userId) {
      const error = new Error("Não é possível abrir chat consigo mesmo.");
      (error as Error & { statusCode: number }).statusCode = 400;
      throw error;
    }

    const contractorId =
      listing.listingType === "PROFESSIONAL_PROFILE" ? userId : listing.userId;
    const providerId =
      listing.listingType === "PROFESSIONAL_PROFILE" ? listing.userId : userId;

    const conversation = await prisma.conversation.upsert({
      where: {
        listingId_contractorId_providerId: { listingId, contractorId, providerId },
      },
      create: {
        listingId,
        contractorId,
        providerId,
      },
      update: {},
      include: {
        listing: { select: { id: true, titulo: true, categoria: true, listingType: true } },
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
        listing: {
          select: { id: true, titulo: true, categoria: true, listingType: true },
        },
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
        contextType: c.jobId ? "job" : "listing",
        jobId: c.jobId ?? undefined,
        listingId: c.listingId ?? undefined,
        contextTitulo: c.job ? c.job.titulo : c.listing?.titulo ?? "Serviço",
        contextCategoria: c.job ? c.job.categoria : c.listing?.categoria ?? "",
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

    const leak = detectContactLeak(trimmed);
    if (leak) {
      const error = new Error(leak);
      (error as Error & { statusCode: number }).statusCode = 400;
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
