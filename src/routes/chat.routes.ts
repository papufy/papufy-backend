import { Router } from "express";
import { chatController } from "../controllers/chat.controller";
import { requireAuth } from "../middleware/auth";
import { validateResourceId } from "../middleware/validateId";
import { rateLimit } from "../middleware/rateLimit";

const chatRoutes = Router();

const messageLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 60,
  keyPrefix: "chat-send",
});

chatRoutes.use(requireAuth);

chatRoutes.get("/conversations", (req, res, next) =>
  chatController.listConversations(req, res, next)
);

chatRoutes.get("/unread", (req, res, next) =>
  chatController.unreadCount(req, res, next)
);

chatRoutes.get(
  "/conversations/:id/messages",
  validateResourceId(),
  (req, res, next) => chatController.getMessages(req, res, next)
);

chatRoutes.post(
  "/conversations/:id/messages",
  validateResourceId(),
  messageLimiter,
  (req, res, next) => chatController.sendMessage(req, res, next)
);

chatRoutes.post(
  "/listings/:id/start",
  validateResourceId(),
  (req, res, next) => chatController.startListingConversation(req, res, next)
);

export { chatRoutes };
