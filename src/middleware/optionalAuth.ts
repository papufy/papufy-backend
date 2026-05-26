import type { NextFunction, Request, Response } from "express";
import { authUserSelect } from "../constants/userSelect";
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
      select: authUserSelect,
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
