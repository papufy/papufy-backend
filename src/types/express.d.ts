import type { Tables } from "./database";

declare global {
  namespace Express {
    interface Request {
      userId?: string;
      user?: Omit<Tables<"User">, "senha" | "asaasSubaccountApiKey">;
    }
  }
}

export {};
