import type { NextFunction, Request, Response } from "express";
import { notificationsService } from "../services/notifications.service";

export class NotificationsController {
  async list(req: Request, res: Response, next: NextFunction) {
    try {
      const result = await notificationsService.listForUser(req.userId!);
      res.json(result);
    } catch (err) {
      next(err);
    }
  }

  async unreadCount(req: Request, res: Response, next: NextFunction) {
    try {
      const result = await notificationsService.unreadCount(req.userId!);
      res.json(result);
    } catch (err) {
      next(err);
    }
  }

  async markRead(req: Request, res: Response, next: NextFunction) {
    try {
      const id = String(req.params.id);
      const result = await notificationsService.markRead(id, req.userId!);
      res.json(result);
    } catch (err) {
      next(err);
    }
  }

  async markAllRead(req: Request, res: Response, next: NextFunction) {
    try {
      const result = await notificationsService.markAllRead(req.userId!);
      res.json(result);
    } catch (err) {
      next(err);
    }
  }
}

export const notificationsController = new NotificationsController();
