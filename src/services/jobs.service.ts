import { JobStatus } from "@prisma/client";
import { prisma } from "../lib/prisma";
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

function mapJob(
  job: {
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
    createdAt: Date;
    user?: { id: string; nome: string; cidade: string | null; uf: string | null };
    _count?: { interests: number };
  },
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
    criador: job.user,
    interesses: job._count?.interests ?? 0,
  };
}

export class JobsService {
  async list(filters: ListJobsFilters) {
    const where: { AND: Array<Record<string, unknown>> } = {
      AND: [{ status: filters.status ?? JobStatus.OPEN }],
    };

    if (filters.category) {
      where.AND.push({ categoria: { equals: filters.category } });
    }

    if (filters.search) {
      const term = sanitizeText(filters.search, 100);
      where.AND.push({
        OR: [
          { titulo: { contains: term } },
          { descricao: { contains: term } },
        ],
      });
    }

    if (filters.uf) {
      where.AND.push({ uf: { equals: filters.uf.toUpperCase() } });
    }

    if (filters.cidade) {
      where.AND.push({ cidade: { contains: filters.cidade } });
    }

    if (filters.location) {
      const parts = filters.location.split(",").map((p) => p.trim());
      if (parts.length >= 2) {
        where.AND.push({ cidade: { contains: parts[0] } });
        where.AND.push({ uf: { equals: parts[1].replace(/\./g, "").toUpperCase() } });
      } else {
        where.AND.push({
          OR: [
            { cidade: { contains: filters.location } },
            { uf: { contains: filters.location.toUpperCase() } },
            { bairro: { contains: filters.location } },
          ],
        });
      }
    }

    const jobs = await prisma.job.findMany({
      where,
      orderBy: { createdAt: "desc" },
      include: {
        user: { select: { id: true, nome: true, cidade: true, uf: true } },
        _count: { select: { interests: true } },
      },
    });

    return jobs.map((j) => mapJob(j));
  }

  async listMine(userId: string) {
    const jobs = await prisma.job.findMany({
      where: { userId },
      orderBy: { createdAt: "desc" },
      include: {
        user: { select: { id: true, nome: true, cidade: true, uf: true } },
        _count: { select: { interests: true } },
      },
    });
    return jobs.map((j) => mapJob(j, { includePhone: true }));
  }

  async getById(id: string, viewerId?: string) {
    const job = await prisma.job.findUnique({
      where: { id },
      include: {
        user: {
          select: {
            id: true,
            nome: true,
            email: true,
            telefone: true,
            cidade: true,
            uf: true,
          },
        },
        _count: { select: { interests: true } },
      },
    });

    if (!job) {
      const error = new Error("Serviço não encontrado.");
      (error as Error & { statusCode: number }).statusCode = 404;
      throw error;
    }

    const isOwner = viewerId === job.userId;
    const mapped = mapJob(job, { includePhone: isOwner });

    let myConversationId: string | null = null;
    if (viewerId && !isOwner) {
      const conversation = await prisma.conversation.findUnique({
        where: { jobId_providerId: { jobId: id, providerId: viewerId } },
        select: { id: true },
      });
      myConversationId = conversation?.id ?? null;
    }

    return {
      ...mapped,
      isOwner,
      myConversationId,
      criador: {
        id: job.user.id,
        nome: job.user.nome,
        cidade: job.user.cidade,
        uf: job.user.uf,
        telefone: isOwner ? job.user.telefone : undefined,
        email: isOwner ? job.user.email : undefined,
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

    const job = await prisma.job.create({
      data: {
        titulo: sanitizeText(data.titulo, 120),
        descricao: sanitizeText(data.descricao, 5000),
        preco: data.aCombinar ? null : data.preco ?? null,
        aCombinar: data.aCombinar,
        categoria: data.categoria,
        cep: data.cep ? sanitizeText(data.cep, 12) : undefined,
        cidade: sanitizeText(data.cidade, 80),
        bairro: data.bairro ? sanitizeText(data.bairro, 80) : undefined,
        uf: data.uf.toUpperCase(),
        telefone: sanitizePhone(data.telefone),
        userId,
        status: JobStatus.OPEN,
      },
      include: {
        user: { select: { id: true, nome: true, cidade: true, uf: true } },
        _count: { select: { interests: true } },
      },
    });

    return mapJob(job, { includePhone: true });
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

    if (job.status === JobStatus.CLOSED) {
      const error = new Error("Serviço encerrado não pode ser editado.");
      (error as Error & { statusCode: number }).statusCode = 400;
      throw error;
    }

    const updated = await prisma.job.update({
      where: { id: jobId },
      data: {
        titulo: data.titulo ? sanitizeText(data.titulo, 120) : undefined,
        descricao: data.descricao ? sanitizeText(data.descricao, 5000) : undefined,
        preco: data.aCombinar ? null : data.preco,
        aCombinar: data.aCombinar,
        categoria: data.categoria,
        cep: data.cep !== undefined ? (data.cep || null) : undefined,
        cidade: data.cidade ? sanitizeText(data.cidade, 80) : undefined,
        bairro: data.bairro !== undefined ? data.bairro || null : undefined,
        uf: data.uf?.toUpperCase(),
        telefone: data.telefone ? sanitizePhone(data.telefone) : undefined,
      },
      include: {
        user: { select: { id: true, nome: true, cidade: true, uf: true } },
        _count: { select: { interests: true } },
      },
    });

    return mapJob(updated, { includePhone: true });
  }

  async close(jobId: string, userId: string) {
    await this.assertOwner(jobId, userId);
    const job = await prisma.job.update({
      where: { id: jobId },
      data: { status: JobStatus.CLOSED },
      include: {
        user: { select: { id: true, nome: true, cidade: true, uf: true } },
        _count: { select: { interests: true } },
      },
    });
    return mapJob(job, { includePhone: true });
  }

  async reopen(jobId: string, userId: string) {
    await this.assertOwner(jobId, userId);
    const job = await prisma.job.update({
      where: { id: jobId },
      data: { status: JobStatus.OPEN },
      include: {
        user: { select: { id: true, nome: true, cidade: true, uf: true } },
        _count: { select: { interests: true } },
      },
    });
    return mapJob(job, { includePhone: true });
  }

  async remove(jobId: string, userId: string) {
    await this.assertOwner(jobId, userId);
    await prisma.job.delete({ where: { id: jobId } });
  }

  async listInterests(jobId: string, userId: string) {
    const job = await this.assertOwner(jobId, userId);

    const interests = await prisma.jobInterest.findMany({
      where: { jobId: job.id },
      orderBy: { createdAt: "desc" },
      include: {
        user: {
          select: { id: true, nome: true, telefone: true, cidade: true, uf: true },
        },
      },
    });

    const conversations = await prisma.conversation.findMany({
      where: { jobId },
      select: { id: true, providerId: true },
    });

    const convByProvider = new Map(
      conversations.map((c) => [c.providerId, c.id])
    );

    return interests.map((i) => ({
      id: i.id,
      createdAt: i.createdAt,
      profissional: i.user,
      conversationId: convByProvider.get(i.userId) ?? null,
    }));
  }

  async registerInterest(jobId: string, userId: string) {
    const job = await prisma.job.findUnique({ where: { id: jobId } });

    if (!job) {
      const error = new Error("Serviço não encontrado.");
      (error as Error & { statusCode: number }).statusCode = 404;
      throw error;
    }

    if (job.status === JobStatus.CLOSED) {
      const error = new Error("Este serviço já foi encerrado.");
      (error as Error & { statusCode: number }).statusCode = 400;
      throw error;
    }

    if (job.userId === userId) {
      const error = new Error("Você não pode demonstrar interesse no seu próprio serviço.");
      (error as Error & { statusCode: number }).statusCode = 400;
      throw error;
    }

    const existingInterest = await prisma.jobInterest.findUnique({
      where: { jobId_userId: { jobId, userId } },
    });

    await prisma.jobInterest.upsert({
      where: { jobId_userId: { jobId, userId } },
      create: { jobId, userId },
      update: {},
    });

    const conversation = await chatService.getOrCreateConversation(jobId, userId);

    const criador = await prisma.user.findUnique({
      where: { id: job.userId },
      select: { nome: true, telefone: true, email: true, cidade: true, uf: true },
    });

    if (!existingInterest) {
      await chatService.sendMessage(
        conversation.id,
        userId,
        `Olá! Tenho interesse no serviço "${job.titulo}". Podemos conversar?`
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
    const job = await prisma.job.findUnique({ where: { id: jobId } });

    if (!job) {
      const error = new Error("Serviço não encontrado.");
      (error as Error & { statusCode: number }).statusCode = 404;
      throw error;
    }

    if (job.userId !== userId) {
      const error = new Error("Sem permissão para este serviço.");
      (error as Error & { statusCode: number }).statusCode = 403;
      throw error;
    }

    return job;
  }
}

export const jobsService = new JobsService();
