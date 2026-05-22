import type { Request, Response, NextFunction } from "express";
import { JobStatus } from "@prisma/client";
import { z } from "zod";
import { jobsService } from "../services/jobs.service";
import { JOB_CATEGORIES } from "../constants/categories";

const createJobSchema = z
  .object({
    titulo: z.string().min(5, "Título deve ter ao menos 5 caracteres."),
    descricao: z.string().min(20, "Descrição deve ter ao menos 20 caracteres."),
    preco: z.number().positive().optional().nullable(),
    aCombinar: z.boolean().default(false),
    categoria: z.enum(JOB_CATEGORIES as unknown as [string, ...string[]]),
    cep: z.string().optional(),
    cidade: z.string().min(2),
    bairro: z.string().optional(),
    uf: z.string().length(2),
    telefone: z.string().min(8),
  })
  .refine(
    (data) => data.aCombinar || (data.preco != null && data.preco > 0),
    { message: "Informe o orçamento ou marque 'A combinar'.", path: ["preco"] }
  );

const updateJobSchema = z.object({
  titulo: z.string().min(5).optional(),
  descricao: z.string().min(20).optional(),
  preco: z.number().positive().optional().nullable(),
  aCombinar: z.boolean().optional(),
  categoria: z.enum(JOB_CATEGORIES as unknown as [string, ...string[]]).optional(),
  cep: z.string().optional(),
  cidade: z.string().min(2).optional(),
  bairro: z.string().optional(),
  uf: z.string().length(2).optional(),
  telefone: z.string().min(8).optional(),
});

export class JobsController {
  async list(req: Request, res: Response, next: NextFunction) {
    try {
      const { search, category, location, uf, cidade, status } = req.query;
      const parsedStatus =
        status === "CLOSED" || status === "OPEN"
          ? (status as JobStatus)
          : undefined;

      const jobs = await jobsService.list({
        search: typeof search === "string" ? search : undefined,
        category: typeof category === "string" ? category : undefined,
        location: typeof location === "string" ? location : undefined,
        uf: typeof uf === "string" ? uf : undefined,
        cidade: typeof cidade === "string" ? cidade : undefined,
        status: parsedStatus,
      });
      res.json({ jobs, total: jobs.length });
    } catch (err) {
      next(err);
    }
  }

  async listMine(req: Request, res: Response, next: NextFunction) {
    try {
      const jobs = await jobsService.listMine(req.userId!);
      res.json({ jobs, total: jobs.length });
    } catch (err) {
      next(err);
    }
  }

  async getById(req: Request, res: Response, next: NextFunction) {
    try {
      const id = String(req.params.id);
      const job = await jobsService.getById(id, req.userId);
      res.json({ job });
    } catch (err) {
      next(err);
    }
  }

  async listInterests(req: Request, res: Response, next: NextFunction) {
    try {
      const id = String(req.params.id);
      const interests = await jobsService.listInterests(id, req.userId!);
      res.json({ interests });
    } catch (err) {
      next(err);
    }
  }

  async create(req: Request, res: Response, next: NextFunction) {
    try {
      const data = createJobSchema.parse(req.body);
      const job = await jobsService.create(req.userId!, data);
      res.status(201).json({ job });
    } catch (err) {
      next(err);
    }
  }

  async update(req: Request, res: Response, next: NextFunction) {
    try {
      const id = String(req.params.id);
      const data = updateJobSchema.parse(req.body);
      const job = await jobsService.update(id, req.userId!, data);
      res.json({ job });
    } catch (err) {
      next(err);
    }
  }

  async close(req: Request, res: Response, next: NextFunction) {
    try {
      const id = String(req.params.id);
      const job = await jobsService.close(id, req.userId!);
      res.json({ job });
    } catch (err) {
      next(err);
    }
  }

  async reopen(req: Request, res: Response, next: NextFunction) {
    try {
      const id = String(req.params.id);
      const job = await jobsService.reopen(id, req.userId!);
      res.json({ job });
    } catch (err) {
      next(err);
    }
  }

  async remove(req: Request, res: Response, next: NextFunction) {
    try {
      const id = String(req.params.id);
      await jobsService.remove(id, req.userId!);
      res.status(204).send();
    } catch (err) {
      next(err);
    }
  }

  async registerInterest(req: Request, res: Response, next: NextFunction) {
    try {
      const id = String(req.params.id);
      const result = await jobsService.registerInterest(id, req.userId!);
      res.json(result);
    } catch (err) {
      next(err);
    }
  }

  async categories(_req: Request, res: Response) {
    res.json({ categories: jobsService.getCategories() });
  }
}

export const jobsController = new JobsController();
