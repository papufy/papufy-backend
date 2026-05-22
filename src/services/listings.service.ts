import { ListingStatus, ListingType, Prisma } from "@prisma/client";
import { prisma } from "../lib/prisma";
import {
  BICO_CATEGORIES,
  PRODUCT_CATEGORIES,
} from "../constants/categories";
import { sanitizePhone, sanitizeText } from "../utils/sanitize";
import { publicFileUrl } from "../middleware/upload";

export interface ListListingsFilters {
  search?: string;
  category?: string;
  tipo?: ListingType;
  uf?: string;
  cidade?: string;
  location?: string;
  minPrice?: number;
  maxPrice?: number;
  status?: ListingStatus;
  limit?: number;
  offset?: number;
}

function resolveImageUrl(url: string): string {
  if (url.startsWith("http://") || url.startsWith("https://")) {
    return url;
  }
  return publicFileUrl(url);
}

function mapListing(
  listing: {
    id: string;
    userId: string;
    tipo: ListingType;
    titulo: string;
    descricao: string;
    preco: number | null;
    aCombinar: boolean;
    categoria: string;
    status: ListingStatus;
    cep: string | null;
    cidade: string;
    bairro: string | null;
    uf: string;
    telefone: string;
    createdAt: Date;
    user?: {
      id: string;
      nome: string;
      cidade: string | null;
      uf: string | null;
    };
    images?: { id: string; url: string; ordem: number }[];
  },
  options?: { includePhone?: boolean }
) {
  const sortedImages = [...(listing.images ?? [])].sort(
    (a, b) => a.ordem - b.ordem
  );

  return {
    id: listing.id,
    userId: listing.userId,
    tipo: listing.tipo,
    titulo: listing.titulo,
    descricao: listing.descricao,
    preco: listing.preco,
    aCombinar: listing.aCombinar,
    categoria: listing.categoria,
    status: listing.status,
    cep: listing.cep,
    cidade: listing.cidade,
    bairro: listing.bairro,
    uf: listing.uf,
    telefone: options?.includePhone ? listing.telefone : undefined,
    createdAt: listing.createdAt,
    criador: listing.user,
    imagens: sortedImages.map((img) => ({
      id: img.id,
      url: resolveImageUrl(img.url),
      ordem: img.ordem,
    })),
    imagemCapa:
      sortedImages.length > 0
        ? resolveImageUrl(sortedImages[0].url)
        : null,
  };
}

export class ListingsService {
  async list(filters: ListListingsFilters) {
    const limit = Math.min(Math.max(filters.limit ?? 20, 1), 50);
    const offset = Math.max(filters.offset ?? 0, 0);

    const where: Prisma.ListingWhereInput = {
      status: filters.status ?? ListingStatus.OPEN,
    };

    if (filters.tipo) {
      where.tipo = filters.tipo;
    }

    if (filters.category) {
      where.categoria = filters.category;
    }

    if (filters.search) {
      const term = sanitizeText(filters.search, 100);
      where.OR = [
        { titulo: { contains: term } },
        { descricao: { contains: term } },
      ];
    }

    if (filters.uf) {
      where.uf = filters.uf.toUpperCase();
    }

    if (filters.cidade) {
      where.cidade = { contains: filters.cidade };
    }

    if (filters.location) {
      const parts = filters.location.split(",").map((p) => p.trim());
      if (parts.length >= 2) {
        where.cidade = { contains: parts[0] };
        where.uf = parts[1].replace(/\./g, "").toUpperCase();
      } else {
        where.OR = [
          { cidade: { contains: filters.location } },
          { uf: { contains: filters.location.toUpperCase() } },
          { bairro: { contains: filters.location } },
        ];
      }
    }

    if (filters.minPrice != null || filters.maxPrice != null) {
      where.AND = [
        ...(Array.isArray(where.AND) ? where.AND : where.AND ? [where.AND] : []),
        {
          OR: [
            { aCombinar: true },
            {
              preco: {
                ...(filters.minPrice != null ? { gte: filters.minPrice } : {}),
                ...(filters.maxPrice != null ? { lte: filters.maxPrice } : {}),
              },
            },
          ],
        },
      ];
    }

    const [items, total] = await Promise.all([
      prisma.listing.findMany({
        where,
        orderBy: { createdAt: "desc" },
        take: limit,
        skip: offset,
        include: {
          user: {
            select: { id: true, nome: true, cidade: true, uf: true },
          },
          images: { orderBy: { ordem: "asc" }, take: 1 },
        },
      }),
      prisma.listing.count({ where }),
    ]);

    return {
      listings: items.map((l) => mapListing(l)),
      total,
      limit,
      offset,
      hasMore: offset + items.length < total,
    };
  }

  async getById(id: string, viewerId?: string) {
    const listing = await prisma.listing.findUnique({
      where: { id },
      include: {
        user: {
          select: { id: true, nome: true, cidade: true, uf: true },
        },
        images: { orderBy: { ordem: "asc" } },
      },
    });

    if (!listing) {
      throw new Error("Anúncio não encontrado.");
    }

    const isOwner = viewerId === listing.userId;

    return {
      listing: {
        ...mapListing(listing, { includePhone: isOwner }),
        isOwner,
      },
    };
  }

  async create(
    userId: string,
    data: {
      tipo: ListingType;
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
      imagePaths?: string[];
    }
  ) {
    const categories: readonly string[] =
      data.tipo === ListingType.PRODUTO
        ? PRODUCT_CATEGORIES
        : BICO_CATEGORIES;

    if (!categories.includes(data.categoria)) {
      throw new Error("Categoria inválida para este tipo de anúncio.");
    }

    const listing = await prisma.listing.create({
      data: {
        userId,
        tipo: data.tipo,
        titulo: sanitizeText(data.titulo, 120),
        descricao: sanitizeText(data.descricao, 4000),
        preco: data.aCombinar ? null : data.preco ?? null,
        aCombinar: data.aCombinar,
        categoria: data.categoria,
        cep: data.cep ? sanitizeText(data.cep, 12) : null,
        cidade: sanitizeText(data.cidade, 80),
        bairro: data.bairro ? sanitizeText(data.bairro, 80) : null,
        uf: data.uf.toUpperCase(),
        telefone: sanitizePhone(data.telefone),
        images: data.imagePaths?.length
          ? {
              create: data.imagePaths.map((url, ordem) => ({
                url,
                ordem,
              })),
            }
          : undefined,
      },
      include: {
        user: {
          select: { id: true, nome: true, cidade: true, uf: true },
        },
        images: { orderBy: { ordem: "asc" } },
      },
    });

    return { listing: mapListing(listing, { includePhone: true }) };
  }
}

export const listingsService = new ListingsService();
