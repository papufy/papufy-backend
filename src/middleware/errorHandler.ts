import { Prisma } from "@prisma/client";
import type { NextFunction, Request, Response } from "express";
import { ZodError } from "zod";
import { env } from "../config/env";

function isPrismaError(err: unknown): err is Prisma.PrismaClientKnownRequestError {
  return err instanceof Prisma.PrismaClientKnownRequestError;
}

export function errorHandler(
  err: unknown,
  _req: Request,
  res: Response,
  _next: NextFunction
): void {
  if (err instanceof ZodError) {
    res.status(400).json({
      error: "Dados inválidos.",
      details: err.flatten().fieldErrors,
    });
    return;
  }

  if (err instanceof Error) {
    const status =
      "statusCode" in err && typeof (err as { statusCode: number }).statusCode === "number"
        ? (err as { statusCode: number }).statusCode
        : 500;

    if (status >= 500) {
      console.error("[api]", err.message, isPrismaError(err) ? err.code : "");
    }

    let message = err.message || "Erro interno do servidor.";
    if (status >= 500 && env.isProduction) {
      if (isPrismaError(err) || err.message.includes("Prisma")) {
        message =
          "Banco de dados indisponível. Verifique DATABASE_URL e DIRECT_URL no Render (Supabase).";
      } else if (err.message.startsWith("CORS bloqueado")) {
        message = err.message;
      } else {
        message = "Erro interno do servidor.";
      }
    }

    res.status(status).json({ error: message });
    return;
  }

  res.status(500).json({
    error: env.isProduction ? "Erro interno do servidor." : "Erro desconhecido.",
  });
}
