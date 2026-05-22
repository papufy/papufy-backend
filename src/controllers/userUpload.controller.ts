import type { Request, Response, NextFunction } from "express";
import { userUploadService } from "../services/userUpload.service";

export class UserUploadController {
  async uploadCurriculo(req: Request, res: Response, next: NextFunction) {
    try {
      const userId = req.user!.id;
      const file = req.file;
      if (!file) {
        res.status(400).json({ error: "Envie um arquivo PDF no campo curriculo." });
        return;
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
      const userId = req.user!.id;
      const files = req.files as Express.Multer.File[] | undefined;
      if (!files?.length) {
        res.status(400).json({
          error: "Envie ao menos uma imagem no campo certificados.",
        });
        return;
      }

      let nomes: string[] | undefined;
      if (typeof req.body.nomes === "string") {
        try {
          nomes = JSON.parse(req.body.nomes) as string[];
        } catch {
          nomes = req.body.nomes.split(",").map((s: string) => s.trim());
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
      const result = await userUploadService.listCertificates(req.user!.id);
      res.json(result);
    } catch (err) {
      next(err);
    }
  }
}

export const userUploadController = new UserUploadController();
