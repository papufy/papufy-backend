import bcrypt from "bcryptjs";
import { prisma } from "../lib/prisma";
import { sanitizeEmail, sanitizePhone, sanitizeText } from "../utils/sanitize";
import { validatePasswordStrength } from "../utils/password";
import { signToken } from "../utils/jwt";

const BCRYPT_ROUNDS = 12;

export class AuthService {
  async register(data: {
    nome: string;
    email: string;
    senha: string;
    telefone?: string;
    cidade?: string;
    uf?: string;
  }) {
    const email = sanitizeEmail(data.email);
    const nome = sanitizeText(data.nome, 120);
    const passwordError = validatePasswordStrength(data.senha);

    if (passwordError) {
      const error = new Error(passwordError);
      (error as Error & { statusCode: number }).statusCode = 400;
      throw error;
    }

    const existing = await prisma.user.findUnique({ where: { email } });

    if (existing) {
      const error = new Error("E-mail já cadastrado.");
      (error as Error & { statusCode: number }).statusCode = 409;
      throw error;
    }

    const senhaHash = await bcrypt.hash(data.senha, BCRYPT_ROUNDS);

    const user = await prisma.user.create({
      data: {
        nome,
        email,
        senha: senhaHash,
        telefone: data.telefone ? sanitizePhone(data.telefone) : undefined,
        cidade: data.cidade ? sanitizeText(data.cidade, 80) : undefined,
        uf: data.uf?.toUpperCase(),
      },
      select: this.userSelect,
    });

    const token = signToken({ sub: user.id, email: user.email });
    return { user, token };
  }

  async login(email: string, senha: string) {
    const user = await prisma.user.findUnique({
      where: { email: sanitizeEmail(email) },
    });

    if (!user) {
      const error = new Error("E-mail ou senha incorretos.");
      (error as Error & { statusCode: number }).statusCode = 401;
      throw error;
    }

    const valid = await bcrypt.compare(senha, user.senha);

    if (!valid) {
      const error = new Error("E-mail ou senha incorretos.");
      (error as Error & { statusCode: number }).statusCode = 401;
      throw error;
    }

    const token = signToken({ sub: user.id, email: user.email });

    return {
      user: {
        id: user.id,
        nome: user.nome,
        email: user.email,
        telefone: user.telefone,
        cidade: user.cidade,
        uf: user.uf,
        createdAt: user.createdAt,
      },
      token,
    };
  }

  async getMe(userId: string) {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: this.userSelect,
    });

    if (!user) {
      const error = new Error("Usuário não encontrado.");
      (error as Error & { statusCode: number }).statusCode = 404;
      throw error;
    }

    return user;
  }

  async updateProfile(
    userId: string,
    data: {
      nome?: string;
      telefone?: string;
      cidade?: string;
      uf?: string;
      senhaAtual?: string;
      novaSenha?: string;
    }
  ) {
    const user = await prisma.user.findUnique({ where: { id: userId } });

    if (!user) {
      const error = new Error("Usuário não encontrado.");
      (error as Error & { statusCode: number }).statusCode = 404;
      throw error;
    }

    const updateData: {
      nome?: string;
      telefone?: string | null;
      cidade?: string | null;
      uf?: string | null;
      senha?: string;
    } = {};

    if (data.nome) updateData.nome = sanitizeText(data.nome, 120);
    if (data.telefone !== undefined) {
      updateData.telefone = data.telefone ? sanitizePhone(data.telefone) : null;
    }
    if (data.cidade !== undefined) {
      updateData.cidade = data.cidade ? sanitizeText(data.cidade, 80) : null;
    }
    if (data.uf !== undefined) {
      updateData.uf = data.uf ? data.uf.toUpperCase() : null;
    }

    if (data.novaSenha) {
      if (!data.senhaAtual) {
        const error = new Error("Informe a senha atual para alterá-la.");
        (error as Error & { statusCode: number }).statusCode = 400;
        throw error;
      }
      const valid = await bcrypt.compare(data.senhaAtual, user.senha);
      if (!valid) {
        const error = new Error("Senha atual incorreta.");
        (error as Error & { statusCode: number }).statusCode = 401;
        throw error;
      }
      const passwordError = validatePasswordStrength(data.novaSenha);
      if (passwordError) {
        const error = new Error(passwordError);
        (error as Error & { statusCode: number }).statusCode = 400;
        throw error;
      }
      updateData.senha = await bcrypt.hash(data.novaSenha, BCRYPT_ROUNDS);
    }

    const updated = await prisma.user.update({
      where: { id: userId },
      data: updateData,
      select: this.userSelect,
    });

    return updated;
  }

  private userSelect = {
    id: true,
    nome: true,
    email: true,
    telefone: true,
    cidade: true,
    uf: true,
    curriculoUrl: true,
    createdAt: true,
  } as const;
}

export const authService = new AuthService();
