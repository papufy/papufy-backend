import crypto from "crypto";
import fs from "fs";
import path from "path";
import multer, { type FileFilterCallback } from "multer";
import type { NextFunction, Request, Response } from "express";
import { env } from "../config/env";
import {
  assertFileMagic,
  extensionForMime,
  type AllowedFileKind,
} from "../utils/fileMagic";
import { badRequest } from "../utils/errors";

const PDF_MAX = 2 * 1024 * 1024;
const IMAGE_MAX = 5 * 1024 * 1024;

function ensureDir(dir: string) {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

ensureDir(env.uploadDir);
ensureDir(path.join(env.uploadDir, "curriculos"));
ensureDir(path.join(env.uploadDir, "certificados"));
ensureDir(path.join(env.uploadDir, "listings"));
ensureDir(path.join(env.uploadDir, "support"));
ensureDir(path.join(env.uploadDir, "chat"));

function rejectFile(
  file: Express.Multer.File,
  cb: FileFilterCallback,
  message: string
) {
  cb(new Error(message));
}

const pdfFilter = (
  _req: Request,
  file: Express.Multer.File,
  cb: FileFilterCallback
) => {
  if (file.mimetype !== "application/pdf") {
    rejectFile(
      file,
      cb,
      "Apenas application/pdf é permitido para o currículo."
    );
    return;
  }
  cb(null, true);
};

const imageFilter = (
  _req: Request,
  file: Express.Multer.File,
  cb: FileFilterCallback
) => {
  const allowed = new Set(["image/jpeg", "image/png"]);
  if (!allowed.has(file.mimetype)) {
    rejectFile(
      file,
      cb,
      "Apenas imagens JPEG ou PNG são permitidas."
    );
    return;
  }
  cb(null, true);
};

function storage(subfolder: string) {
  return multer.diskStorage({
    destination: (_req, _file, cb) => {
      const dest = path.join(env.uploadDir, subfolder);
      ensureDir(dest);
      cb(null, dest);
    },
    filename: (_req, file, cb) => {
      const ext = extensionForMime(file.mimetype);
      if (!ext) {
        cb(new Error("Tipo de arquivo não suportado."), "");
        return;
      }
      cb(null, `${crypto.randomUUID()}${ext}`);
    },
  });
}

function handleMulterError(
  err: unknown,
  _req: Request,
  res: Response,
  next: NextFunction
): void {
  if (err instanceof multer.MulterError) {
    if (err.code === "LIMIT_FILE_SIZE") {
      res.status(400).json({ error: "Arquivo excede o tamanho máximo permitido." });
      return;
    }
    if (err.code === "LIMIT_FILE_COUNT") {
      res.status(400).json({ error: "Número máximo de arquivos excedido." });
      return;
    }
    res.status(400).json({ error: "Falha no upload do arquivo." });
    return;
  }
  if (err instanceof Error) {
    res.status(400).json({ error: err.message });
    return;
  }
  next(err);
}

type MulterMiddleware = (
  req: Request,
  res: Response,
  next: NextFunction
) => void;

function wrapMulter(middleware: MulterMiddleware): MulterMiddleware {
  return (req: Request, res: Response, next: NextFunction) => {
    middleware(req, res, (err: unknown) => {
      if (err) {
        handleMulterError(err, req, res, next);
        return;
      }
      next();
    });
  };
}

const curriculoMulter = multer({
  storage: storage("curriculos"),
  limits: { fileSize: PDF_MAX, files: 1 },
  fileFilter: pdfFilter,
}).single("curriculo");

const certificadosMulter = multer({
  storage: storage("certificados"),
  limits: { fileSize: IMAGE_MAX, files: 8 },
  fileFilter: imageFilter,
}).array("certificados", 8);

const listingImagesMulter = multer({
  storage: storage("listings"),
  limits: { fileSize: IMAGE_MAX, files: 10 },
  fileFilter: imageFilter,
}).array("imagens", 10);

const supportProofMulter = multer({
  storage: storage("support"),
  limits: { fileSize: IMAGE_MAX, files: 1 },
  fileFilter: imageFilter,
}).single("comprovante");

const chatImageMulter = multer({
  storage: storage("chat"),
  limits: { fileSize: IMAGE_MAX, files: 1 },
  fileFilter: imageFilter,
}).single("imagem");

export const uploadCurriculo = wrapMulter(curriculoMulter);

export const uploadCertificados = wrapMulter(certificadosMulter);

export const uploadListingImages = wrapMulter(listingImagesMulter);
export const uploadSupportProof = wrapMulter(supportProofMulter);
export const uploadChatImage = wrapMulter(chatImageMulter);

export async function validateCurriculoUpload(
  req: Request,
  _res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const file = req.file;
    if (!file) {
      next(badRequest("Envie um arquivo PDF no campo curriculo."));
      return;
    }
    await assertFileMagic(file.path, "pdf");
    next();
  } catch (err) {
    if (req.file?.path) {
      fs.unlink(req.file.path, () => undefined);
    }
    next(err instanceof Error ? err : badRequest("Arquivo inválido."));
  }
}

export async function validateCertificadosUpload(
  req: Request,
  _res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const files = (req.files as Express.Multer.File[] | undefined) ?? [];
    if (!files.length) {
      next(badRequest("Envie ao menos uma imagem no campo certificados."));
      return;
    }
    for (const file of files) {
      const kind: AllowedFileKind =
        file.mimetype === "image/png" ? "png" : "jpeg";
      await assertFileMagic(file.path, kind);
    }
    next();
  } catch (err) {
    const files = (req.files as Express.Multer.File[] | undefined) ?? [];
    for (const file of files) {
      fs.unlink(file.path, () => undefined);
    }
    next(err instanceof Error ? err : badRequest("Imagem inválida."));
  }
}

export async function validateListingImagesUpload(
  req: Request,
  _res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const files = (req.files as Express.Multer.File[] | undefined) ?? [];
    for (const file of files) {
      const kind: AllowedFileKind =
        file.mimetype === "image/png" ? "png" : "jpeg";
      await assertFileMagic(file.path, kind);
    }
    next();
  } catch (err) {
    const files = (req.files as Express.Multer.File[] | undefined) ?? [];
    for (const file of files) {
      fs.unlink(file.path, () => undefined);
    }
    next(err instanceof Error ? err : badRequest("Imagem inválida."));
  }
}

export async function validateSupportProofUpload(
  req: Request,
  _res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const file = req.file;
    if (!file) {
      next();
      return;
    }
    const kind: AllowedFileKind = file.mimetype === "image/png" ? "png" : "jpeg";
    await assertFileMagic(file.path, kind);
    next();
  } catch (err) {
    if (req.file?.path) {
      fs.unlink(req.file.path, () => undefined);
    }
    next(err instanceof Error ? err : badRequest("Imagem inválida."));
  }
}

export async function validateChatImageUpload(
  req: Request,
  _res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const file = req.file;
    if (!file) {
      next(badRequest("Envie uma imagem no campo imagem."));
      return;
    }
    const kind: AllowedFileKind = file.mimetype === "image/png" ? "png" : "jpeg";
    await assertFileMagic(file.path, kind);
    next();
  } catch (err) {
    if (req.file?.path) {
      fs.unlink(req.file.path, () => undefined);
    }
    next(err instanceof Error ? err : badRequest("Imagem inválida."));
  }
}

export function publicFileUrl(relativePath: string): string {
  const normalized = relativePath.replace(/\\/g, "/");
  return `${env.publicBaseUrl}/uploads/${normalized}`;
}
