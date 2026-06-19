import type { NextFunction, Request, Response } from "express";
import { ZodError } from "zod";
import { env } from "../config/env";
import { PaymentProfileIncompleteError } from "../errors/paymentProfile";
import { AppError } from "../utils/errors";

export function errorHandler(
  err: unknown,
  _req: Request,
  res: Response,
  _next: NextFunction
): void {
  if (err instanceof ZodError) {
    const fieldErrors = err.flatten().fieldErrors;
    const messages = Object.values(fieldErrors)
      .flat()
      .filter((message): message is string => typeof message === "string");
    res.status(400).json({
      error:
        messages.length === 1
          ? messages[0]
          : messages.length > 1
            ? `Preencha os campos obrigatórios: ${messages.join("; ")}.`
            : "Dados inválidos.",
      details: fieldErrors,
    });
    return;
  }

  if (err instanceof PaymentProfileIncompleteError) {
    res.status(err.statusCode).json({
      error: err.message,
      code: err.code,
      role: err.role,
      missingFields: err.missingFields,
    });
    return;
  }

  if (err instanceof AppError) {
    res.status(err.statusCode).json({ error: err.message });
    return;
  }

  if (err instanceof Error) {
    const status =
      "statusCode" in err &&
      typeof (err as { statusCode: number }).statusCode === "number"
        ? (err as { statusCode: number }).statusCode
        : 500;

    if (status >= 500) {
      console.error("[api]", err.message);
    }

    const message =
      status >= 500 && env.isProduction
        ? "Erro interno do servidor."
        : err.message || "Erro interno do servidor.";

    res.status(status).json({ error: message });
    return;
  }

  res.status(500).json({
    error: env.isProduction ? "Erro interno do servidor." : "Erro desconhecido.",
  });
}
