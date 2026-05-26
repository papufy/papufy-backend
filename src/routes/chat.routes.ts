import { Router } from "express";
import { chatController } from "../controllers/chat.controller";
import { requireAuth } from "../middleware/auth";

const chatRoutes = Router();

chatRoutes.use(requireAuth);

chatRoutes.get("/conversations", (req, res, next) =>
  chatController.listConversations(req, res, next)
);
chatRoutes.get("/unread", (req, res, next) =>
  chatController.unreadCount(req, res, next)
);
chatRoutes.get("/conversations/:id/messages", (req, res, next) =>
  chatController.getMessages(req, res, next)
);
chatRoutes.post("/conversations/:id/messages", (req, res, next) =>
  chatController.sendMessage(req, res, next)
);

chatRoutes.post("/listings/:id/start", (req, res, next) =>
  chatController.startListingConversation(req, res, next)
);

export { chatRoutes };
