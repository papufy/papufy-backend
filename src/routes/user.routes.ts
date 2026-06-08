import { Router } from "express";
import { reputationController } from "../controllers/reputation.controller";
import { userUploadController } from "../controllers/userUpload.controller";
import { requireAuth } from "../middleware/auth";
import {
  uploadCertificados,
  uploadCurriculo,
  validateCertificadosUpload,
  validateCurriculoUpload,
} from "../middleware/upload";
import { rateLimit } from "../middleware/rateLimit";

const userRoutes = Router();

const uploadLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 15,
  keyPrefix: "user-upload",
});

userRoutes.post(
  "/upload-curriculo",
  requireAuth,
  uploadLimiter,
  uploadCurriculo,
  validateCurriculoUpload,
  (req, res, next) => userUploadController.uploadCurriculo(req, res, next)
);

userRoutes.post(
  "/upload-certificado",
  requireAuth,
  uploadLimiter,
  uploadCertificados,
  validateCertificadosUpload,
  (req, res, next) => userUploadController.uploadCertificados(req, res, next)
);

userRoutes.get("/certificados", requireAuth, (req, res, next) =>
  userUploadController.listCertificates(req, res, next)
);

userRoutes.get("/reputation", requireAuth, (req, res, next) =>
  reputationController.getMine(req, res, next)
);

userRoutes.get("/reviews/transaction/:transactionId", requireAuth, (req, res, next) =>
  reputationController.getByTransaction(req, res, next)
);

userRoutes.post("/reviews", requireAuth, (req, res, next) =>
  reputationController.createReview(req, res, next)
);

userRoutes.get("/:userId/reputation", (req, res, next) =>
  reputationController.getByUserId(req, res, next)
);

export { userRoutes };
