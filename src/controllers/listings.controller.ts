import { ListingType } from "@prisma/client";
import type { Request, Response, NextFunction } from "express";
import { z } from "zod";
import { BICO_CATEGORIES, PRODUCT_CATEGORIES } from "../constants/categories";
import { listingsService } from "../services/listings.service";

const listQuerySchema = z.object({
  search: z.string().optional(),
  category: z.string().optional(),
  tipo: z.enum(["BICO", "PRODUTO"]).optional(),
  location: z.string().optional(),
  uf: z.string().optional(),
  cidade: z.string().optional(),
  minPrice: z.coerce.number().optional(),
  maxPrice: z.coerce.number().optional(),
  limit: z.coerce.number().optional(),
  offset: z.coerce.number().optional(),
});

const createListingSchema = z.object({
  tipo: z.enum(["BICO", "PRODUTO"]),
  titulo: z.string().min(5).max(120),
  descricao: z.string().min(20).max(4000),
  preco: z.coerce.number().positive().optional().nullable(),
  aCombinar: z.coerce.boolean().default(false),
  categoria: z.string().min(2),
  cep: z.string().optional(),
  cidade: z.string().min(2),
  bairro: z.string().optional(),
  uf: z.string().length(2),
  telefone: z.string().min(8),
});

export class ListingsController {
  async list(req: Request, res: Response, next: NextFunction) {
    try {
      const query = listQuerySchema.parse(req.query);
      const result = await listingsService.list({
        ...query,
        tipo: query.tipo as ListingType | undefined,
      });
      res.json(result);
    } catch (err) {
      next(err);
    }
  }

  async getById(req: Request, res: Response, next: NextFunction) {
    try {
      const viewerId = req.user?.id;
      const id = String(req.params.id);
      const result = await listingsService.getById(id, viewerId);
      res.json(result);
    } catch (err) {
      next(err);
    }
  }

  async create(req: Request, res: Response, next: NextFunction) {
    try {
      const userId = req.user!.id;
      const body = createListingSchema.parse(req.body);

      const files = req.files as Express.Multer.File[] | undefined;
      const imagePaths =
        files?.map((f) => `listings/${f.filename}`) ?? [];

      const parsed = body;

      if (
        parsed.tipo === "BICO" &&
        !BICO_CATEGORIES.includes(parsed.categoria as (typeof BICO_CATEGORIES)[number])
      ) {
        res.status(400).json({ error: "Categoria inválida para bico/serviço." });
        return;
      }

      if (
        parsed.tipo === "PRODUTO" &&
        !PRODUCT_CATEGORIES.includes(
          parsed.categoria as (typeof PRODUCT_CATEGORIES)[number]
        )
      ) {
        res.status(400).json({ error: "Categoria inválida para produto." });
        return;
      }

      const result = await listingsService.create(userId, {
        tipo: parsed.tipo as ListingType,
        titulo: parsed.titulo,
        descricao: parsed.descricao,
        preco: parsed.aCombinar ? null : parsed.preco ?? null,
        aCombinar: parsed.aCombinar,
        categoria: parsed.categoria,
        cep: parsed.cep,
        cidade: parsed.cidade,
        bairro: parsed.bairro,
        uf: parsed.uf,
        telefone: parsed.telefone,
        imagePaths,
      });

      res.status(201).json(result);
    } catch (err) {
      next(err);
    }
  }
}

export const listingsController = new ListingsController();
