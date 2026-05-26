import bcrypt from "bcryptjs";
import { assertNoError, newId, supabase } from "../lib/db";
import type { Tables } from "../types/database";
import { sanitizeEmail, sanitizePhone, sanitizeText } from "../utils/sanitize";
import { validatePasswordStrength } from "../utils/password";
import { signToken } from "../utils/jwt";

const BCRYPT_ROUNDS = 12;

type PublicUser = Pick<
  Tables<"User">,
  "id" | "nome" | "email" | "telefone" | "cidade" | "uf" | "curriculoUrl" | "createdAt"
>;

const USER_PUBLIC_SELECT =
  "id, nome, email, telefone, cidade, uf, curriculoUrl, createdAt" as const;

export class AuthService {
  async register(data: {
    nome: string;
    email: string;
    senha: string;
    cpfCnpj: string;
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

    const { data: existing } = await supabase
      .from("User")
      .select("id")
      .eq("email", email)
      .maybeSingle();

    if (existing) {
      const error = new Error("E-mail já cadastrado.");
      (error as Error & { statusCode: number }).statusCode = 409;
      throw error;
    }

    const cpfCnpj = data.cpfCnpj.replace(/\D/g, "");
    if (cpfCnpj.length !== 11 && cpfCnpj.length !== 14) {
      const error = new Error("CPF ou CNPJ inválido.");
      (error as Error & { statusCode: number }).statusCode = 400;
      throw error;
    }

    const { data: existingDoc } = await supabase
      .from("User")
      .select("id")
      .eq("cpfCnpj", cpfCnpj)
      .maybeSingle();

    if (existingDoc) {
      const error = new Error("CPF/CNPJ já cadastrado.");
      (error as Error & { statusCode: number }).statusCode = 409;
      throw error;
    }

    const senhaHash = await bcrypt.hash(data.senha, BCRYPT_ROUNDS);

    const user = assertNoError<PublicUser>(
      await supabase
        .from("User")
        .insert({
          id: newId(),
          nome,
          email,
          senha: senhaHash,
          cpfCnpj,
          telefone: data.telefone ? sanitizePhone(data.telefone) : null,
          cidade: data.cidade ? sanitizeText(data.cidade, 80) : null,
          uf: data.uf?.toUpperCase() ?? null,
        })
        .select(USER_PUBLIC_SELECT)
        .single()
    );

    const token = signToken({ sub: user.id, email: user.email });
    return { user, token };
  }

  async login(email: string, senha: string) {
    const { data: user, error } = await supabase
      .from("User")
      .select("*")
      .eq("email", sanitizeEmail(email))
      .maybeSingle();

    if (error || !user) {
      const err = new Error("E-mail ou senha incorretos.");
      (err as Error & { statusCode: number }).statusCode = 401;
      throw err;
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
    const user = assertNoError<PublicUser>(
      await supabase
        .from("User")
        .select(USER_PUBLIC_SELECT)
        .eq("id", userId)
        .maybeSingle(),
      "Usuário não encontrado."
    );

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
    const user = assertNoError<Tables<"User">>(
      await supabase.from("User").select("*").eq("id", userId).maybeSingle(),
      "Usuário não encontrado."
    );

    const updateData: {
      nome?: string;
      telefone?: string | null;
      cidade?: string | null;
      uf?: string | null;
      senha?: string;
      updatedAt?: string;
    } = { updatedAt: new Date().toISOString() };

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

    const updated = assertNoError<PublicUser>(
      await supabase
        .from("User")
        .update(updateData)
        .eq("id", userId)
        .select(USER_PUBLIC_SELECT)
        .single()
    );

    return updated;
  }
}

export const authService = new AuthService();
