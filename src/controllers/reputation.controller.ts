import type { Request, Response, NextFunction } from "express";
import { z } from "zod";
import { reputationService } from "../services/reputation.service";

const createReviewSchema = z.object({
  transactionId: z.string().min(1),
  rating: z.coerce.number().int().min(1).max(5),
  comment: z.string().max(500).optional(),
});

export class ReputationController {
  async getMine(req: Request, res: Response, next: NextFunction) {
    try {
      const reputation = await reputationService.getForUser(req.user!.id);
      res.json({ reputation });
    } catch (err) {
      next(err);
    }
  }

  async getByUserId(req: Request, res: Response, next: NextFunction) {
    try {
      const userId = String(req.params.userId);
      const reputation = await reputationService.getForUser(userId);
      res.json({ reputation });
    } catch (err) {
      next(err);
    }
  }

  async getByTransaction(req: Request, res: Response, next: NextFunction) {
    try {
      const transactionId = String(req.params.transactionId);
      const review = await reputationService.getReviewByTransaction(
        transactionId,
        req.user!.id
      );
      res.json({ review });
    } catch (err) {
      next(err);
    }
  }

  async createReview(req: Request, res: Response, next: NextFunction) {
    try {
      const body = createReviewSchema.parse(req.body);
      const result = await reputationService.createReview(req.user!.id, body);
      res.status(201).json(result);
    } catch (err) {
      next(err);
    }
  }
}

export const reputationController = new ReputationController();
