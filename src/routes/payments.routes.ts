import { Router } from "express";
import { paymentsController } from "../controllers/payments.controller";
import { requireAuth } from "../middleware/auth";
import {
  uploadSupportProof,
  validateSupportProofUpload,
} from "../middleware/upload";

export const paymentsRoutes = Router();

paymentsRoutes.post("/webhook", (req, res, next) =>
  paymentsController.webhook(req, res, next)
);

paymentsRoutes.post("/onboarding-account", requireAuth, (req, res, next) =>
  paymentsController.onboardRecipient(req, res, next)
);

paymentsRoutes.post("/checkout", requireAuth, (req, res, next) =>
  paymentsController.checkout(req, res, next)
);

paymentsRoutes.post("/proposals/:messageId/checkout", requireAuth, (req, res, next) =>
  paymentsController.checkoutFromProposal(req, res, next)
);

paymentsRoutes.get("/wallet", requireAuth, (req, res, next) =>
  paymentsController.walletSummary(req, res, next)
);

paymentsRoutes.get("/transactions/mine", requireAuth, (req, res, next) =>
  paymentsController.listMyTransactions(req, res, next)
);

paymentsRoutes.get("/transactions/:id/status", requireAuth, (req, res, next) =>
  paymentsController.transactionStatus(req, res, next)
);

paymentsRoutes.post(
  "/transactions/:id/report",
  requireAuth,
  uploadSupportProof,
  validateSupportProofUpload,
  (req, res, next) => paymentsController.reportProblem(req, res, next)
);

paymentsRoutes.post("/transactions/:id/confirm-completion", requireAuth, (req, res, next) =>
  paymentsController.confirmCompletion(req, res, next)
);

paymentsRoutes.post("/transactions/:id/withdraw", requireAuth, (req, res, next) =>
  paymentsController.withdraw(req, res, next)
);

