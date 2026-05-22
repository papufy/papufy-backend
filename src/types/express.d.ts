import type { User } from "@prisma/client";

declare global {
  namespace Express {
    interface Request {
      userId?: string;
      user?: Omit<User, "senha">;
    }
  }
}

export {};
