import type { Request, Response, NextFunction } from "express";
import { z } from "zod";
import { userUploadService } from "../services/userUpload.service";
import { badRequest } from "../utils/errors";
import { sanitizeText } from "../utils/sanitize";

const nomesSchema = z.array(z.string().min(1).max(120)).max(8);

export class UserUploadController {
  async uploadCurriculo(req: Request, res: Response, next: NextFunction) {
    try {
      const userId = req.userId!;
      const file = req.file;
      if (!file) {
        throw badRequest("Envie um arquivo PDF no campo curriculo.");
      }
      const result = await userUploadService.uploadCurriculo(
        userId,
        file.filename
      );
      res.status(201).json({
        message: "Currículo enviado com sucesso.",
        ...result,
      });
    } catch (err) {
      next(err);
    }
  }

  async uploadCertificados(req: Request, res: Response, next: NextFunction) {
    try {
      const userId = req.userId!;
      const files = req.files as Express.Multer.File[] | undefined;
      if (!files?.length) {
        throw badRequest("Envie ao menos uma imagem no campo certificados.");
      }

      let nomes: string[] | undefined;
      if (typeof req.body.nomes === "string") {
        try {
          const parsed = JSON.parse(req.body.nomes) as unknown;
          nomes = nomesSchema.parse(parsed);
        } catch {
          nomes = req.body.nomes
            .split(",")
            .map((s: string) => sanitizeText(s, 120))
            .filter(Boolean);
        }
      }

      const result = await userUploadService.uploadCertificados(
        userId,
        files,
        nomes
      );
      res.status(201).json({
        message: "Certificado(s) enviado(s) com sucesso.",
        ...result,
      });
    } catch (err) {
      next(err);
    }
  }

  async listCertificates(req: Request, res: Response, next: NextFunction) {
    try {
      const result = await userUploadService.listCertificates(req.userId!);
      res.json(result);
    } catch (err) {
      next(err);
    }
  }
}

export const userUploadController = new UserUploadController();
