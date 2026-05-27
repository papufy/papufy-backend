import type { NextFunction, Request, Response } from "express";
import { env } from "../config/env";
import { assertNoError, supabase } from "../lib/db";
import type { Tables } from "../types/database";
import { AppError } from "../utils/errors";
import { verifyToken } from "../utils/jwt";

/** Nunca expor asaasSubaccountApiKey em respostas HTTP. */
type PublicUser = Omit<Tables<"User">, "senha" | "asaasSubaccountApiKey">;

export async function requireAuth(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  const header = req.headers.authorization;

  let rawToken: string | undefined;
  if (header?.startsWith("Bearer ")) {
    rawToken = header.slice(7).trim();
  } else if (!env.isProduction && typeof req.query.token === "string") {
    rawToken = req.query.token.trim();
  }

  if (!rawToken) {
    res.status(401).json({ error: "Token de autenticação ausente." });
    return;
  }

  try {
    const payload = verifyToken(rawToken);
    const user = assertNoError<PublicUser>(
      await supabase
        .from("User")
        .select(
          "id, nome, email, telefone, cidade, uf, curriculoUrl, cpfCnpj, asaasCustomerId, asaasWalletId, asaasAccountId, createdAt, updatedAt"
        )
        .eq("id", payload.sub)
        .maybeSingle()
    );

    req.userId = user.id;
    req.user = user;
    next();
  } catch (err) {
    if (err instanceof AppError) {
      res.status(err.statusCode).json({ error: err.message });
      return;
    }
    res.status(401).json({ error: "Token inválido ou expirado." });
  }
}
