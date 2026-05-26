import type { NextFunction, Request, Response } from "express";
import { z } from "zod";
import { badRequest } from "../utils/errors";

const uuidSchema = z.string().uuid();

export function validateResourceId(
  paramName = "id"
): (req: Request, _res: Response, next: NextFunction) => void {
  return (req, _res, next) => {
    const value = req.params[paramName];
    const parsed = uuidSchema.safeParse(value);
    if (!parsed.success) {
      next(badRequest("Identificador de recurso inválido."));
      return;
    }
    next();
  };
}
