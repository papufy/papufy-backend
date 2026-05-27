import type { NextFunction, Request, Response } from "express";
import { z } from "zod";
import { chatService } from "../services/chat.service";
import { publishChatMessageToPeers } from "../utils/chatNotify";
import { badRequest } from "../utils/errors";

export class ChatController {
  async startListingConversation(req: Request, res: Response, next: NextFunction) {
    try {
      const listingId = String(req.params.id);
      const conversation = await chatService.getOrCreateListingConversation(
        listingId,
        req.userId!
      );
      if (!conversation?.id) {
        res.status(500).json({ error: "Não foi possível abrir a conversa." });
        return;
      }
      res.status(201).json({ conversationId: conversation.id });
    } catch (err) {
      next(err);
    }
  }

  async listConversations(req: Request, res: Response, next: NextFunction) {
    try {
      const [conversations, unreadTotal] = await Promise.all([
        chatService.listConversations(req.userId!),
        chatService.getUnreadCount(req.userId!),
      ]);
      res.json({ conversations, unreadTotal });
    } catch (err) {
      next(err);
    }
  }

  async getMessages(req: Request, res: Response, next: NextFunction) {
    try {
      const id = String(req.params.id);
      const messages = await chatService.getMessages(id, req.userId!);
      res.json({ messages });
    } catch (err) {
      next(err);
    }
  }

  async sendMessage(req: Request, res: Response, next: NextFunction) {
    try {
      const id = String(req.params.id);
      const { content } = z
        .object({ content: z.string().min(1).max(2000) })
        .parse(req.body);
      const message = await chatService.sendMessage(id, req.userId!, content);
      await publishChatMessageToPeers(id, req.userId!, {
        ...message,
        isMine: false,
      });
      res.status(201).json({ message });
    } catch (err) {
      next(err);
    }
  }

  async sendImage(req: Request, res: Response, next: NextFunction) {
    try {
      const id = String(req.params.id);
      const file = req.file;
      if (!file?.filename) {
        throw badRequest("Envie uma imagem JPEG ou PNG.");
      }
      const message = await chatService.sendImageMessage(
        id,
        req.userId!,
        file.filename
      );
      await publishChatMessageToPeers(id, req.userId!, {
        ...message,
        isMine: false,
      });
      res.status(201).json({ message });
    } catch (err) {
      next(err);
    }
  }

  async sendProposal(req: Request, res: Response, next: NextFunction) {
    try {
      const id = String(req.params.id);
      const { value, receiverProfile } = z
        .object({
          value: z.coerce.number().positive(),
          receiverProfile: z
            .object({
              cpfCnpj: z.string().min(11).optional(),
              telefone: z.string().min(8).optional(),
            })
            .optional(),
        })
        .parse(req.body);
      const message = await chatService.createProposal(
        id,
        req.userId!,
        value,
        receiverProfile
      );
      res.status(201).json({ message });
    } catch (err) {
      next(err);
    }
  }

  async unreadCount(req: Request, res: Response, next: NextFunction) {
    try {
      const count = await chatService.getUnreadCount(req.userId!);
      res.json({ count });
    } catch (err) {
      next(err);
    }
  }
}

export const chatController = new ChatController();
