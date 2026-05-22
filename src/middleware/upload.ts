import fs from "fs";
import path from "path";
import multer, { type FileFilterCallback } from "multer";
import type { Request } from "express";
import { env } from "../config/env";

function ensureDir(dir: string) {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

ensureDir(env.uploadDir);
ensureDir(path.join(env.uploadDir, "curriculos"));
ensureDir(path.join(env.uploadDir, "certificados"));
ensureDir(path.join(env.uploadDir, "listings"));

const pdfFilter = (
  _req: Request,
  file: Express.Multer.File,
  cb: FileFilterCallback
) => {
  if (file.mimetype === "application/pdf") {
    cb(null, true);
    return;
  }
  cb(new Error("Apenas arquivos PDF são permitidos para o currículo."));
};

const imageFilter = (
  _req: Request,
  file: Express.Multer.File,
  cb: FileFilterCallback
) => {
  if (file.mimetype.startsWith("image/")) {
    cb(null, true);
    return;
  }
  cb(new Error("Apenas imagens são permitidas."));
};

function storage(subfolder: string) {
  return multer.diskStorage({
    destination: (_req, _file, cb) => {
      const dest = path.join(env.uploadDir, subfolder);
      ensureDir(dest);
      cb(null, dest);
    },
    filename: (_req, file, cb) => {
      const safe = file.originalname.replace(/[^a-zA-Z0-9._-]/g, "_");
      cb(null, `${Date.now()}-${safe}`);
    },
  });
}

export const uploadCurriculo = multer({
  storage: storage("curriculos"),
  limits: { fileSize: 8 * 1024 * 1024 },
  fileFilter: pdfFilter,
}).single("curriculo");

export const uploadCertificados = multer({
  storage: storage("certificados"),
  limits: { fileSize: 6 * 1024 * 1024, files: 8 },
  fileFilter: imageFilter,
}).array("certificados", 8);

export const uploadListingImages = multer({
  storage: storage("listings"),
  limits: { fileSize: 6 * 1024 * 1024, files: 10 },
  fileFilter: imageFilter,
}).array("imagens", 10);

export function publicFileUrl(relativePath: string): string {
  const normalized = relativePath.replace(/\\/g, "/");
  return `${env.publicBaseUrl}/uploads/${normalized}`;
}
