import type { Request, Response, NextFunction } from "express";
import { z } from "zod";
import { listingsService } from "../services/listings.service";
import { uploadListingImages } from "../services/listingImageStorage.service";
import { normalizeListingType, type ListingType } from "../types/enums";
import { formBoolean, optionalFormBoolean } from "../utils/formBoolean";

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

const updateListingSchema = z.object({
  titulo: z
    .string()
    .min(5, "Título deve ter pelo menos 5 caracteres.")
    .max(120, "Título deve ter no máximo 120 caracteres.")
    .optional(),
  descricao: z
    .string()
    .min(20, "Descrição deve ter pelo menos 20 caracteres.")
    .max(4000, "Descrição deve ter no máximo 4000 caracteres.")
    .optional(),
  preco: z.coerce
    .number({ invalid_type_error: "Informe um preço válido." })
    .positive("Informe um preço maior que zero.")
    .optional()
    .nullable(),
  aCombinar: optionalFormBoolean(),
  semQualificacao: optionalFormBoolean(),
  cep: z.string().optional().nullable(),
  cidade: z.string().min(2, "Informe a cidade.").optional(),
  bairro: z.string().optional().nullable(),
  uf: z.string().length(2, "Informe a UF com 2 letras.").optional(),
  telefone: z
    .string()
    .min(8, "Telefone deve ter pelo menos 8 dígitos.")
    .optional(),
});

const createListingSchema = z.object({
  listingType: listingTypeInput.optional(),
  tipo: listingTypeInput.optional(),
  titulo: z
    .string({ required_error: "Informe o título." })
    .min(5, "Título deve ter pelo menos 5 caracteres.")
    .max(120, "Título deve ter no máximo 120 caracteres."),
  descricao: z
    .string({ required_error: "Informe a descrição." })
    .min(20, "Descrição deve ter pelo menos 20 caracteres.")
    .max(4000, "Descrição deve ter no máximo 4000 caracteres."),
  preco: z.coerce
    .number({ invalid_type_error: "Informe um preço válido." })
    .positive("Informe um preço maior que zero.")
    .optional()
    .nullable(),
  aCombinar: formBoolean(false),
  categoria: z.string().min(2).optional(),
  semQualificacao: formBoolean(false),
  cep: z.string().optional(),
  cidade: z
    .string({ required_error: "Informe a cidade." })
    .min(2, "Informe a cidade."),
  bairro: z.string().optional(),
  uf: z
    .string({ required_error: "Informe a UF." })
    .length(2, "Informe a UF com 2 letras."),
  telefone: z
    .string({ required_error: "Informe o telefone." })
    .min(8, "Telefone deve ter pelo menos 8 dígitos."),
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
        files && files.length > 0
          ? await uploadListingImages(files)
          : [];

      const listingType = resolveListingType({
        listingType: body.listingType,
        tipo: body.tipo,
      });

      if (!listingType) {
        res.status(400).json({ error: "Tipo de anúncio é obrigatório." });
        return;
      }

      const result = await listingsService.create(userId, {
        tipo: listingType,
        titulo: body.titulo,
        descricao: body.descricao,
        preco: body.aCombinar ? null : body.preco ?? null,
        aCombinar: body.aCombinar,
        categoria: body.categoria?.trim() || "Geral",
        semQualificacao: body.semQualificacao,
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

  async update(req: Request, res: Response, next: NextFunction) {
    try {
      const userId = req.user!.id;
      const id = String(req.params.id);
      const body = updateListingSchema.parse(req.body);

      const result = await listingsService.update(id, userId, {
        titulo: body.titulo,
        descricao: body.descricao,
        preco: body.aCombinar ? null : body.preco ?? undefined,
        aCombinar: body.aCombinar,
        semQualificacao: body.semQualificacao,
        cep: body.cep ?? undefined,
        cidade: body.cidade,
        bairro: body.bairro,
        uf: body.uf,
        telefone: body.telefone,
      });

      res.json(result);
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
