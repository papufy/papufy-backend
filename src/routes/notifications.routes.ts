import { Router } from "express";
import { notificationsController } from "../controllers/notifications.controller";
import { requireAuth } from "../middleware/auth";

export const notificationsRoutes = Router();

notificationsRoutes.get("/", requireAuth, (req, res, next) =>
  notificationsController.list(req, res, next)
);

notificationsRoutes.get("/unread-count", requireAuth, (req, res, next) =>
  notificationsController.unreadCount(req, res, next)
);

notificationsRoutes.patch("/read-all", requireAuth, (req, res, next) =>
  notificationsController.markAllRead(req, res, next)
);

notificationsRoutes.patch("/:id/read", requireAuth, (req, res, next) =>
  notificationsController.markRead(req, res, next)
);
