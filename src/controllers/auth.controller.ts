import type { Request, Response, NextFunction } from "express";
import { z } from "zod";
import { authService } from "../services/auth.service";

const registerSchema = z.object({
  nome: z.string().min(2, "Nome deve ter ao menos 2 caracteres."),
  email: z.string().email("E-mail inválido."),
  senha: z.string().min(8, "Senha deve ter ao menos 8 caracteres."),
  telefone: z.string().optional(),
  cidade: z.string().optional(),
  uf: z.string().length(2).optional(),
});

const loginSchema = z.object({
  email: z.string().email("E-mail inválido."),
  senha: z.string().min(1, "Senha obrigatória."),
});

const profileSchema = z.object({
  nome: z.string().min(2).optional(),
  telefone: z.string().optional(),
  cidade: z.string().optional(),
  uf: z.string().length(2).optional(),
  senhaAtual: z.string().optional(),
  novaSenha: z.string().min(8).optional(),
});

export class AuthController {
  async register(req: Request, res: Response, next: NextFunction) {
    try {
      const data = registerSchema.parse(req.body);
      const result = await authService.register(data);
      res.status(201).json(result);
    } catch (err) {
      next(err);
    }
  }

  async login(req: Request, res: Response, next: NextFunction) {
    try {
      const { email, senha } = loginSchema.parse(req.body);
      const result = await authService.login(email, senha);
      res.json(result);
    } catch (err) {
      next(err);
    }
  }

  async me(req: Request, res: Response, next: NextFunction) {
    try {
      if (!req.userId) {
        res.status(401).json({ error: "Não autenticado." });
        return;
      }
      const user = await authService.getMe(req.userId);
      res.json({ user });
    } catch (err) {
      next(err);
    }
  }

  async updateProfile(req: Request, res: Response, next: NextFunction) {
    try {
      const data = profileSchema.parse(req.body);
      const user = await authService.updateProfile(req.userId!, data);
      res.json({ user });
    } catch (err) {
      next(err);
    }
  }
}

export const authController = new AuthController();
