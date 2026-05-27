import type { NextFunction, Request, Response } from "express";
import { supabase } from "../lib/db";
import type { Tables } from "../types/database";
import { verifyToken } from "../utils/jwt";

type PublicUser = Omit<Tables<"User">, "senha" | "asaasSubaccountApiKey">;

const USER_PUBLIC_SELECT =
  "id, nome, email, telefone, cidade, uf, curriculoUrl, cpfCnpj, asaasCustomerId, asaasWalletId, asaasAccountId, createdAt, updatedAt";

export async function optionalAuth(
  req: Request,
  _res: Response,
  next: NextFunction
): Promise<void> {
  const header = req.headers.authorization;

  if (!header?.startsWith("Bearer ")) {
    next();
    return;
  }

  const token = header.slice(7);

  try {
    const payload = verifyToken(token);
    const { data: user } = await supabase
      .from("User")
      .select(USER_PUBLIC_SELECT)
      .eq("id", payload.sub)
      .maybeSingle();

    if (user) {
      req.userId = user.id;
      req.user = user as PublicUser;
    }
  } catch {
    /* ignore invalid token */
  }

  next();
}
