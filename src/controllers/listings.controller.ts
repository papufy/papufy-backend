import type { Request, Response, NextFunction } from "express";
import { z } from "zod";
import {
  JOB_VACANCY_CATEGORIES,
  PROFESSIONAL_PROFILE_CATEGORIES,
} from "../constants/categories";
import { listingsService } from "../services/listings.service";
import { normalizeListingType, type ListingType } from "../types/enums";

const listingTypeInput = z.enum([
  "JOB_VACANCY",
  "PROFESSIONAL_PROFILE",
  "BICO",
  "PRODUTO",
]);

const listQuerySchema = z.object({
  search: z.string().optional(),
  category: z.string().optional(),
  listingType: listingTypeInput.optional(),
  tipo: listingTypeInput.optional(),
  location: z.string().optional(),
  uf: z.string().optional(),
  cidade: z.string().optional(),
  minPrice: z.coerce.number().optional(),
  maxPrice: z.coerce.number().optional(),
  limit: z.coerce.number().optional(),
  offset: z.coerce.number().optional(),
});

const createListingSchema = z.object({
  listingType: listingTypeInput.optional(),
  tipo: listingTypeInput.optional(),
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

function resolveListingType(input: {
  listingType?: string;
  tipo?: string;
}): ListingType | undefined {
  return (
    normalizeListingType(input.listingType) ??
    normalizeListingType(input.tipo)
  );
}

export class ListingsController {
  async list(req: Request, res: Response, next: NextFunction) {
    try {
      const query = listQuerySchema.parse(req.query);
      const listingType = resolveListingType({
        listingType: query.listingType,
        tipo: query.tipo,
      });
      const result = await listingsService.list({
        search: query.search,
        category: query.category,
        tipo: listingType,
        location: query.location,
        uf: query.uf,
        cidade: query.cidade,
        minPrice: query.minPrice,
        maxPrice: query.maxPrice,
        limit: query.limit,
        offset: query.offset,
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

      const listingType = resolveListingType({
        listingType: body.listingType,
        tipo: body.tipo,
      });

      if (!listingType) {
        res.status(400).json({ error: "Tipo de anúncio é obrigatório." });
        return;
      }

      if (
        listingType === "JOB_VACANCY" &&
        !JOB_VACANCY_CATEGORIES.includes(
          body.categoria as (typeof JOB_VACANCY_CATEGORIES)[number]
        )
      ) {
        res
          .status(400)
          .json({ error: "Categoria inválida para pedido de serviço." });
        return;
      }

      if (
        listingType === "PROFESSIONAL_PROFILE" &&
        !PROFESSIONAL_PROFILE_CATEGORIES.includes(
          body.categoria as (typeof PROFESSIONAL_PROFILE_CATEGORIES)[number]
        )
      ) {
        res
          .status(400)
          .json({ error: "Categoria inválida para perfil profissional." });
        return;
      }

      const result = await listingsService.create(userId, {
        tipo: listingType,
        titulo: body.titulo,
        descricao: body.descricao,
        preco: body.aCombinar ? null : body.preco ?? null,
        aCombinar: body.aCombinar,
        categoria: body.categoria,
        cep: body.cep,
        cidade: body.cidade,
        bairro: body.bairro,
        uf: body.uf,
        telefone: body.telefone,
        imagePaths,
      });

      res.status(201).json(result);
    } catch (err) {
      next(err);
    }
  }

  async listMine(req: Request, res: Response, next: NextFunction) {
    try {
      const userId = req.user!.id;
      const result = await listingsService.listMine(userId);
      res.json(result);
    } catch (err) {
      next(err);
    }
  }

  async close(req: Request, res: Response, next: NextFunction) {
    try {
      const userId = req.user!.id;
      const id = String(req.params.id);
      const result = await listingsService.close(id, userId);
      res.json(result);
    } catch (err) {
      next(err);
    }
  }

  async reopen(req: Request, res: Response, next: NextFunction) {
    try {
      const userId = req.user!.id;
      const id = String(req.params.id);
      const result = await listingsService.reopen(id, userId);
      res.json(result);
    } catch (err) {
      next(err);
    }
  }

  async remove(req: Request, res: Response, next: NextFunction) {
    try {
      const userId = req.user!.id;
      const id = String(req.params.id);
      await listingsService.remove(id, userId);
      res.status(204).send();
    } catch (err) {
      next(err);
    }
  }
}

export const listingsController = new ListingsController();
