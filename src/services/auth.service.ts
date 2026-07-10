import bcrypt from "bcryptjs";
import { assertNoError, newId, supabase } from "../lib/db";
import type { Tables } from "../types/database";
import { sanitizeEmail, sanitizePhone, sanitizeText } from "../utils/sanitize";
import { validatePasswordStrength } from "../utils/password";
import { parseBirthDateInput, isValidBirthDate } from "../utils/birthDate";
import { signToken } from "../utils/jwt";
import { badRequest } from "../utils/errors";
import {
  normalizeAptidoes,
  normalizeHorarios,
  parseAptidoes,
  parseHorarios,
  type HorarioDisponivel,
} from "../utils/qualificacoes";

const BCRYPT_ROUNDS = 12;

type PublicUser = Pick<
  Tables<"User">,
  | "id"
  | "nome"
  | "email"
  | "telefone"
  | "cidade"
  | "uf"
  | "curriculoUrl"
  | "cpfCnpj"
  | "dataNascimento"
  | "createdAt"
> & {
  aptidoes: string[];
  horariosDisponiveis: HorarioDisponivel[];
};

const USER_PUBLIC_SELECT =
  "id, nome, email, telefone, cidade, uf, curriculoUrl, cpfCnpj, dataNascimento, aptidoes, horariosDisponiveis, createdAt" as const;

function toPublicUser(row: Record<string, unknown>): PublicUser {
  return {
    id: row.id as string,
    nome: row.nome as string,
    email: row.email as string,
    telefone: (row.telefone as string | null) ?? null,
    cidade: (row.cidade as string | null) ?? null,
    uf: (row.uf as string | null) ?? null,
    curriculoUrl: (row.curriculoUrl as string | null) ?? null,
    cpfCnpj: (row.cpfCnpj as string | null) ?? null,
    dataNascimento: (row.dataNascimento as string | null) ?? null,
    aptidoes: parseAptidoes(row.aptidoes),
    horariosDisponiveis: parseHorarios(row.horariosDisponiveis),
    createdAt: row.createdAt as string,
  };
}

export class AuthService {
  async register(data: {
    nome: string;
    email: string;
    senha: string;
    cpfCnpj: string;
    telefone?: string;
    cidade?: string;
    uf?: string;
    dataNascimento?: string;
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

    let dataNascimento: string | null = null;
    if (cpfCnpj.length === 11) {
      if (!data.dataNascimento?.trim()) {
        throw badRequest("Informe a data de nascimento.");
      }
      dataNascimento = parseBirthDateInput(data.dataNascimento);
      if (!isValidBirthDate(dataNascimento)) {
        throw badRequest(
          "Data de nascimento inválida. Informe uma data válida (18+ anos)."
        );
      }
    }

    const senhaHash = await bcrypt.hash(data.senha, BCRYPT_ROUNDS);

    const row = assertNoError<Record<string, unknown>>(
      await supabase
        .from("User")
        .insert({
          id: newId(),
          nome,
          email,
          senha: senhaHash,
          cpfCnpj,
          dataNascimento,
          telefone: data.telefone ? sanitizePhone(data.telefone) : null,
          cidade: data.cidade ? sanitizeText(data.cidade, 80) : null,
          uf: data.uf?.toUpperCase() ?? null,
          aptidoes: [],
          horariosDisponiveis: [],
        })
        .select(USER_PUBLIC_SELECT)
        .single()
    );

    const user = toPublicUser(row);
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
      const err = new Error("E-mail ou senha incorretos.");
      (err as Error & { statusCode: number }).statusCode = 401;
      throw err;
    }

    const token = signToken({ sub: user.id, email: user.email });

    await supabase
      .from("User")
      .update({ updatedAt: new Date().toISOString() })
      .eq("id", user.id);

    return {
      user: toPublicUser(user as Record<string, unknown>),
      token,
    };
  }

  async getMe(userId: string) {
    const row = assertNoError<Record<string, unknown>>(
      await supabase
        .from("User")
        .select(USER_PUBLIC_SELECT)
        .eq("id", userId)
        .maybeSingle(),
      "Usuário não encontrado."
    );

    return toPublicUser(row);
  }

  async updateProfile(
    userId: string,
    data: {
      nome?: string;
      telefone?: string;
      cidade?: string;
      uf?: string;
      cpfCnpj?: string;
      dataNascimento?: string;
      senhaAtual?: string;
      novaSenha?: string;
      aptidoes?: string[];
      horariosDisponiveis?: HorarioDisponivel[];
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
      cpfCnpj?: string;
      dataNascimento?: string | null;
      senha?: string;
      aptidoes?: string[];
      horariosDisponiveis?: HorarioDisponivel[];
      updatedAt?: string;
    } = { updatedAt: new Date().toISOString() };

    if (data.cpfCnpj !== undefined) {
      const doc = data.cpfCnpj.replace(/\D/g, "");
      if (doc.length !== 11 && doc.length !== 14) {
        throw badRequest("CPF deve ter 11 dígitos ou CNPJ 14 dígitos.");
      }
      updateData.cpfCnpj = doc;
    }
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
    if (data.dataNascimento !== undefined) {
      if (!data.dataNascimento) {
        const doc = (updateData.cpfCnpj ?? user.cpfCnpj ?? "").replace(/\D/g, "");
        if (doc.length === 11) {
          throw badRequest("Informe a data de nascimento.");
        }
        updateData.dataNascimento = null;
      } else {
        const birthDate = parseBirthDateInput(data.dataNascimento);
        if (!isValidBirthDate(birthDate)) {
          throw badRequest(
            "Data de nascimento inválida. Informe uma data válida (18+ anos)."
          );
        }
        updateData.dataNascimento = birthDate;
      }
    }

    if (data.aptidoes !== undefined) {
      updateData.aptidoes = normalizeAptidoes(data.aptidoes);
    }
    if (data.horariosDisponiveis !== undefined) {
      updateData.horariosDisponiveis = normalizeHorarios(
        data.horariosDisponiveis
      );
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

    const row = assertNoError<Record<string, unknown>>(
      await supabase
        .from("User")
        .update(updateData)
        .eq("id", userId)
        .select(USER_PUBLIC_SELECT)
        .single()
    );

    return toPublicUser(row);
  }
}

export const authService = new AuthService();
