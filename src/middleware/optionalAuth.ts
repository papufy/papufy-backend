import type { NextFunction, Request, Response } from "express";
import { prisma } from "../lib/prisma";
import { verifyToken } from "../utils/jwt";

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
    const user = await prisma.user.findUnique({
      where: { id: payload.sub },
      select: {
        id: true,
        nome: true,
        email: true,
        telefone: true,
        cidade: true,
        uf: true,
        curriculoUrl: true,
        createdAt: true,
        updatedAt: true,
      },
    });
    if (user) {
      req.userId = user.id;
      req.user = user;
    }
  } catch {
    /* ignore invalid token */
  }

  next();
}
