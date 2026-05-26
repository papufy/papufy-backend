import type { NextFunction, Request, Response } from "express";
import { authUserSelect } from "../constants/userSelect";
import { prisma } from "../lib/prisma";
import { verifyToken } from "../utils/jwt";

export async function requireAuth(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  const header = req.headers.authorization;
  const queryToken =
    typeof req.query.token === "string" ? req.query.token : undefined;

  const rawToken = header?.startsWith("Bearer ")
    ? header.slice(7)
    : queryToken;

  if (!rawToken) {
    res.status(401).json({ error: "Token de autenticação ausente." });
    return;
  }

  const token = rawToken;

  try {
    const payload = verifyToken(token);
    const user = await prisma.user.findUnique({
      where: { id: payload.sub },
      select: authUserSelect,
    });

    if (!user) {
      res.status(401).json({ error: "Usuário não encontrado." });
      return;
    }

    req.userId = user.id;
    req.user = user;
    next();
  } catch {
    res.status(401).json({ error: "Token inválido ou expirado." });
  }
}
