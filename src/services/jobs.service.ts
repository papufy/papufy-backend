import type { JobStatus } from "../types/enums";
import type { Tables } from "../types/database";
import { assertNoError, newId, supabase } from "../lib/db";
import { JOB_CATEGORIES } from "../constants/categories";
import { sanitizePhone, sanitizeText } from "../utils/sanitize";
import { chatService } from "./chat.service";

export interface ListJobsFilters {
  search?: string;
  category?: string;
  location?: string;
  uf?: string;
  cidade?: string;
  status?: JobStatus;
}

const JOB_SELECT = `*, User!Job_userId_fkey(id, nome, cidade, uf)`;

type JobRow = {
  id: string;
  titulo: string;
  descricao: string;
  preco: number | null;
  aCombinar: boolean;
  categoria: string;
  status: JobStatus;
  cep: string | null;
  cidade: string;
  bairro: string | null;
  uf: string;
  telefone: string;
  userId: string;
  createdAt: string;
  User?: { id: string; nome: string; cidade: string | null; uf: string | null };
};

async function interestCountByJobIds(
  jobIds: string[]
): Promise<Map<string, number>> {
  const map = new Map<string, number>();
  if (jobIds.length === 0) return map;

  const rows = assertNoError(
    await supabase.from("JobInterest").select("jobId").in("jobId", jobIds)
  );

  for (const row of rows) {
    map.set(row.jobId, (map.get(row.jobId) ?? 0) + 1);
  }
  return map;
}

function mapJob(
  job: JobRow,
  interestCount: number,
  options?: { includePhone?: boolean }
) {
  return {
    id: job.id,
    titulo: job.titulo,
    descricao: job.descricao,
    preco: job.preco,
    aCombinar: job.aCombinar,
    categoria: job.categoria,
    status: job.status,
    cep: job.cep,
    cidade: job.cidade,
    bairro: job.bairro,
    uf: job.uf,
    telefone: options?.includePhone ? job.telefone : undefined,
    userId: job.userId,
    createdAt: job.createdAt,
    criador: job.User,
    interesses: interestCount,
  };
}

export class JobsService {
  async list(filters: ListJobsFilters) {
    let query = supabase
      .from("Job")
      .select(JOB_SELECT)
      .eq("status", filters.status ?? "OPEN");

    if (filters.category) {
      query = query.eq("categoria", filters.category);
    }

    if (filters.search) {
      const term = sanitizeText(filters.search, 100);
      query = query.or(`titulo.ilike.%${term}%,descricao.ilike.%${term}%`);
    }

    if (filters.uf) {
      query = query.eq("uf", filters.uf.toUpperCase());
    }

    if (filters.cidade) {
      query = query.ilike("cidade", `%${filters.cidade}%`);
    }

    if (filters.location) {
      const parts = filters.location.split(",").map((p) => p.trim());
      if (parts.length >= 2) {
        query = query.ilike("cidade", `%${parts[0]}%`);
        query = query.eq("uf", parts[1].replace(/\./g, "").toUpperCase());
      } else {
        const loc = filters.location;
        query = query.or(
          `cidade.ilike.%${loc}%,uf.ilike.%${loc.toUpperCase()}%,bairro.ilike.%${loc}%`
        );
      }
    }

    query = query.order("createdAt", { ascending: false });

    const jobs = assertNoError(await query) as JobRow[];
    const counts = await interestCountByJobIds(jobs.map((j) => j.id));

    return jobs.map((j) => mapJob(j, counts.get(j.id) ?? 0));
  }

  async listMine(userId: string) {
    const jobs = assertNoError(
      await supabase
        .from("Job")
        .select(JOB_SELECT)
        .eq("userId", userId)
        .order("createdAt", { ascending: false })
    ) as JobRow[];

    const counts = await interestCountByJobIds(jobs.map((j) => j.id));
    return jobs.map((j) => mapJob(j, counts.get(j.id) ?? 0, { includePhone: true }));
  }

  async getById(id: string, viewerId?: string) {
    const job = assertNoError(
      await supabase
        .from("Job")
        .select(
          `*, User!Job_userId_fkey(id, nome, email, telefone, cidade, uf)`
        )
        .eq("id", id)
        .maybeSingle(),
      "Trabalho não encontrado."
    ) as JobRow & {
      User: {
        id: string;
        nome: string;
        email: string;
        telefone: string | null;
        cidade: string | null;
        uf: string | null;
      };
    };

    const counts = await interestCountByJobIds([job.id]);
    const isOwner = viewerId === job.userId;
    const mapped = mapJob(job, counts.get(job.id) ?? 0, {
      includePhone: isOwner,
    });

    let myConversationId: string | null = null;
    if (viewerId && !isOwner) {
      const { data: conversation } = await supabase
        .from("Conversation")
        .select("id")
        .eq("jobId", id)
        .eq("providerId", viewerId)
        .maybeSingle();
      myConversationId = conversation?.id ?? null;
    }

    return {
      ...mapped,
      isOwner,
      myConversationId,
      criador: {
        id: job.User.id,
        nome: job.User.nome,
        cidade: job.User.cidade,
        uf: job.User.uf,
        telefone: isOwner ? job.User.telefone : undefined,
        email: isOwner ? job.User.email : undefined,
      },
    };
  }

  async create(
    userId: string,
    data: {
      titulo: string;
      descricao: string;
      preco?: number | null;
      aCombinar: boolean;
      categoria: string;
      cep?: string;
      cidade: string;
      bairro?: string;
      uf: string;
      telefone: string;
    }
  ) {
    if (!JOB_CATEGORIES.includes(data.categoria as (typeof JOB_CATEGORIES)[number])) {
      const error = new Error("Categoria inválida.");
      (error as Error & { statusCode: number }).statusCode = 400;
      throw error;
    }

    const job = assertNoError(
      await supabase
        .from("Job")
        .insert({
          id: newId(),
          titulo: sanitizeText(data.titulo, 120),
          descricao: sanitizeText(data.descricao, 5000),
          preco: data.aCombinar ? null : (data.preco ?? null),
          aCombinar: data.aCombinar,
          categoria: data.categoria,
          cep: data.cep ? sanitizeText(data.cep, 12) : null,
          cidade: sanitizeText(data.cidade, 80),
          bairro: data.bairro ? sanitizeText(data.bairro, 80) : null,
          uf: data.uf.toUpperCase(),
          telefone: sanitizePhone(data.telefone),
          userId,
          status: "OPEN",
        })
        .select(JOB_SELECT)
        .single()
    ) as JobRow;

    return mapJob(job, 0, { includePhone: true });
  }

  async update(
    jobId: string,
    userId: string,
    data: Partial<{
      titulo: string;
      descricao: string;
      preco: number | null;
      aCombinar: boolean;
      categoria: string;
      cep: string;
      cidade: string;
      bairro: string;
      uf: string;
      telefone: string;
    }>
  ) {
    const job = await this.assertOwner(jobId, userId);

    if (job.status === "CLOSED") {
      const error = new Error("Trabalho encerrado não pode ser editado.");
      (error as Error & { statusCode: number }).statusCode = 400;
      throw error;
    }

    const updated = assertNoError(
      await supabase
        .from("Job")
        .update({
          titulo: data.titulo ? sanitizeText(data.titulo, 120) : undefined,
          descricao: data.descricao
            ? sanitizeText(data.descricao, 5000)
            : undefined,
          preco: data.aCombinar ? null : data.preco,
          aCombinar: data.aCombinar,
          categoria: data.categoria,
          cep: data.cep !== undefined ? data.cep || null : undefined,
          cidade: data.cidade ? sanitizeText(data.cidade, 80) : undefined,
          bairro: data.bairro !== undefined ? data.bairro || null : undefined,
          uf: data.uf?.toUpperCase(),
          telefone: data.telefone ? sanitizePhone(data.telefone) : undefined,
          updatedAt: new Date().toISOString(),
        })
        .eq("id", jobId)
        .select(JOB_SELECT)
        .single()
    ) as JobRow;

    const counts = await interestCountByJobIds([jobId]);
    return mapJob(updated, counts.get(jobId) ?? 0, { includePhone: true });
  }

  async close(jobId: string, userId: string) {
    await this.assertOwner(jobId, userId);
    const job = assertNoError(
      await supabase
        .from("Job")
        .update({ status: "CLOSED", updatedAt: new Date().toISOString() })
        .eq("id", jobId)
        .select(JOB_SELECT)
        .single()
    ) as JobRow;
    const counts = await interestCountByJobIds([jobId]);
    return mapJob(job, counts.get(jobId) ?? 0, { includePhone: true });
  }

  async reopen(jobId: string, userId: string) {
    await this.assertOwner(jobId, userId);
    const job = assertNoError(
      await supabase
        .from("Job")
        .update({ status: "OPEN", updatedAt: new Date().toISOString() })
        .eq("id", jobId)
        .select(JOB_SELECT)
        .single()
    ) as JobRow;
    const counts = await interestCountByJobIds([jobId]);
    return mapJob(job, counts.get(jobId) ?? 0, { includePhone: true });
  }

  async remove(jobId: string, userId: string) {
    await this.assertOwner(jobId, userId);
    const { error } = await supabase.from("Job").delete().eq("id", jobId);
    if (error) {
      const err = new Error(error.message);
      (err as Error & { statusCode: number }).statusCode = 500;
      throw err;
    }
  }

  async listInterests(jobId: string, userId: string) {
    const job = await this.assertOwner(jobId, userId);

    const interests = assertNoError(
      await supabase
        .from("JobInterest")
        .select(
          "*, user:User!JobInterest_userId_fkey(id, nome, telefone, cidade, uf)"
        )
        .eq("jobId", job.id)
        .order("createdAt", { ascending: false })
    );

    const conversations = assertNoError(
      await supabase
        .from("Conversation")
        .select("id, providerId")
        .eq("jobId", jobId)
    );

    const convByProvider = new Map(
      conversations.map((c) => [c.providerId, c.id])
    );

    return interests.map((i) => {
      const user = i.user as {
        id: string;
        nome: string;
        telefone: string | null;
        cidade: string | null;
        uf: string | null;
      };
      return {
        id: i.id,
        createdAt: i.createdAt,
        profissional: user,
        conversationId: convByProvider.get(i.userId) ?? null,
      };
    });
  }

  async registerInterest(jobId: string, userId: string) {
    const job = assertNoError<Tables<"Job">>(
      await supabase.from("Job").select("*").eq("id", jobId).maybeSingle(),
      "Trabalho não encontrado."
    );

    if (job.status === "CLOSED") {
      const error = new Error("Este trabalho já foi encerrado.");
      (error as Error & { statusCode: number }).statusCode = 400;
      throw error;
    }

    if (job.userId === userId) {
      const error = new Error(
        "Você não pode demonstrar interesse no seu próprio trabalho."
      );
      (error as Error & { statusCode: number }).statusCode = 400;
      throw error;
    }

    const { data: existingInterest } = await supabase
      .from("JobInterest")
      .select("id")
      .eq("jobId", jobId)
      .eq("userId", userId)
      .maybeSingle();

    await supabase.from("JobInterest").upsert(
      { id: newId(), jobId, userId },
      { onConflict: "jobId,userId", ignoreDuplicates: true }
    );

    const conversation = await chatService.getOrCreateConversation(
      jobId,
      userId
    );

    const criador = assertNoError(
      await supabase
        .from("User")
        .select("nome, telefone, email, cidade, uf")
        .eq("id", job.userId)
        .single()
    );

    if (!existingInterest) {
      await chatService.sendMessage(
        conversation.id,
        userId,
        `Olá! Tenho interesse no trabalho "${job.titulo}". Podemos conversar?`
      );
    }

    return {
      conversationId: conversation.id,
      contato: {
        telefone: job.telefone,
        whatsappLink: `https://wa.me/55${job.telefone.replace(/\D/g, "")}`,
        contratante: criador,
      },
      mensagem:
        "Interesse registrado! Abra o chat para combinar com o contratante.",
    };
  }

  getCategories() {
    return JOB_CATEGORIES;
  }

  private async assertOwner(jobId: string, userId: string) {
    const job = assertNoError<Tables<"Job">>(
      await supabase.from("Job").select("*").eq("id", jobId).maybeSingle(),
      "Trabalho não encontrado."
    );

    if (job.userId !== userId) {
      const error = new Error("Sem permissão para este trabalho.");
      (error as Error & { statusCode: number }).statusCode = 403;
      throw error;
    }

    return job;
  }
}

export const jobsService = new JobsService();
