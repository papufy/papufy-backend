import type { NextFunction, Request, Response } from "express";
import { z } from "zod";
import { chatService } from "../services/chat.service";

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
      const conversations = await chatService.listConversations(req.userId!);
      const unreadTotal = await chatService.getUnreadCount(req.userId!);
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
