import { Router } from "express";
import { userUploadController } from "../controllers/userUpload.controller";
import { requireAuth } from "../middleware/auth";
import {
  uploadCertificados,
  uploadCurriculo,
} from "../middleware/upload";

export const userRoutes = Router();

userRoutes.post(
  "/upload-curriculo",
  requireAuth,
  uploadCurriculo,
  (req, res, next) => userUploadController.uploadCurriculo(req, res, next)
);

userRoutes.post(
  "/upload-certificado",
  requireAuth,
  uploadCertificados,
  (req, res, next) => userUploadController.uploadCertificados(req, res, next)
);

userRoutes.get("/certificados", requireAuth, (req, res, next) =>
  userUploadController.listCertificates(req, res, next)
);
