import type { ListingStatus, ListingType } from "../types/enums";
import { assertNoError, newId, supabase } from "../lib/db";
import {
  BICO_CATEGORIES,
  PRODUCT_CATEGORIES,
} from "../constants/categories";
import { sanitizePhone, sanitizeText } from "../utils/sanitize";
import { forbidden } from "../utils/errors";
import { publicFileUrl } from "../middleware/upload";
import type { Tables } from "../types/database";

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

const LISTING_LIST_SELECT = `
  *,
  User!Listing_userId_fkey(id, nome, cidade, uf),
  images:ListingImage(id, url, ordem)
`;

type ListingRow = {
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
  createdAt: string;
  User?: { id: string; nome: string; cidade: string | null; uf: string | null };
  images?: { id: string; url: string; ordem: number }[];
};

function resolveImageUrl(url: string): string {
  if (url.startsWith("http://") || url.startsWith("https://")) {
    return url;
  }
  return publicFileUrl(url);
}

function mapListing(
  listing: ListingRow,
  options?: { includePhone?: boolean; allImages?: boolean }
) {
  const images = [...(listing.images ?? [])].sort((a, b) => a.ordem - b.ordem);
  const visibleImages = options?.allImages ? images : images.slice(0, 1);

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
    criador: listing.User,
    imagens: visibleImages.map((img) => ({
      id: img.id,
      url: resolveImageUrl(img.url),
      ordem: img.ordem,
    })),
    imagemCapa:
      images.length > 0 ? resolveImageUrl(images[0].url) : null,
  };
}

export class ListingsService {
  private async assertOwner(listingId: string, userId: string) {
    const listing = assertNoError<Pick<Tables<"Listing">, "id" | "userId">>(
      await supabase
        .from("Listing")
        .select("id, userId")
        .eq("id", listingId)
        .maybeSingle(),
      "Anúncio não encontrado."
    );

    if (listing.userId !== userId) {
      throw forbidden("Sem permissão para alterar este anúncio.");
    }

    return listing;
  }

  async list(filters: ListListingsFilters) {
    const limit = Math.min(Math.max(filters.limit ?? 20, 1), 50);
    const offset = Math.max(filters.offset ?? 0, 0);

    let query = supabase
      .from("Listing")
      .select(LISTING_LIST_SELECT, { count: "exact" })
      .eq("status", filters.status ?? "OPEN");

    if (filters.tipo) {
      query = query.eq("tipo", filters.tipo);
    }

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

    if (filters.minPrice != null || filters.maxPrice != null) {
      const parts: string[] = ["aCombinar.eq.true"];
      if (filters.minPrice != null && filters.maxPrice != null) {
        parts.push(
          `and(preco.gte.${filters.minPrice},preco.lte.${filters.maxPrice})`
        );
      } else if (filters.minPrice != null) {
        parts.push(`preco.gte.${filters.minPrice}`);
      } else if (filters.maxPrice != null) {
        parts.push(`preco.lte.${filters.maxPrice}`);
      }
      query = query.or(parts.join(","));
    }

    query = query
      .order("createdAt", { ascending: false })
      .range(offset, offset + limit - 1);

    const { data, count, error } = await query;

    if (error) {
      const err = new Error(error.message);
      (err as Error & { statusCode: number }).statusCode = 500;
      throw err;
    }

    const items = (data ?? []) as ListingRow[];
    const total = count ?? 0;

    return {
      listings: items.map((l) => mapListing(l)),
      total,
      limit,
      offset,
      hasMore: offset + items.length < total,
    };
  }

  async getById(id: string, viewerId?: string) {
    const listing = assertNoError(
      await supabase
        .from("Listing")
        .select(
          `*, User!Listing_userId_fkey(id, nome, cidade, uf), images:ListingImage(id, url, ordem)`
        )
        .eq("id", id)
        .maybeSingle(),
      "Anúncio não encontrado."
    ) as ListingRow;

    const isOwner = viewerId === listing.userId;

    return {
      listing: {
        ...mapListing(listing, { includePhone: isOwner, allImages: true }),
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
      data.tipo === "PRODUTO" ? PRODUCT_CATEGORIES : BICO_CATEGORIES;

    if (!categories.includes(data.categoria)) {
      throw new Error("Categoria inválida para este tipo de anúncio.");
    }

    const listingId = newId();

    const listing = assertNoError(
      await supabase
        .from("Listing")
        .insert({
          id: listingId,
          userId,
          tipo: data.tipo,
          titulo: sanitizeText(data.titulo, 120),
          descricao: sanitizeText(data.descricao, 4000),
          preco: data.aCombinar ? null : (data.preco ?? null),
          aCombinar: data.aCombinar,
          categoria: data.categoria,
          cep: data.cep ? sanitizeText(data.cep, 12) : null,
          cidade: sanitizeText(data.cidade, 80),
          bairro: data.bairro ? sanitizeText(data.bairro, 80) : null,
          uf: data.uf.toUpperCase(),
          telefone: sanitizePhone(data.telefone),
        })
        .select(
          `*, User!Listing_userId_fkey(id, nome, cidade, uf), images:ListingImage(id, url, ordem)`
        )
        .single()
    ) as ListingRow;

    if (data.imagePaths?.length) {
      const imageRows = data.imagePaths.map((url, ordem) => ({
        id: newId(),
        listingId,
        url,
        ordem,
      }));
      await supabase.from("ListingImage").insert(imageRows);

      const withImages = assertNoError(
        await supabase
          .from("Listing")
          .select(
            `*, User!Listing_userId_fkey(id, nome, cidade, uf), images:ListingImage(id, url, ordem)`
          )
          .eq("id", listingId)
          .single()
      ) as ListingRow;

      return {
        listing: mapListing(withImages, { includePhone: true, allImages: true }),
      };
    }

    return { listing: mapListing(listing, { includePhone: true, allImages: true }) };
  }

  async close(listingId: string, userId: string) {
    await this.assertOwner(listingId, userId);
    const updated = assertNoError(
      await supabase
        .from("Listing")
        .update({
          status: "CLOSED" as ListingStatus,
          updatedAt: new Date().toISOString(),
        })
        .eq("id", listingId)
        .select(
          `*, User!Listing_userId_fkey(id, nome, cidade, uf), images:ListingImage(id, url, ordem)`
        )
        .single()
    ) as ListingRow;
    return { listing: mapListing(updated, { includePhone: true, allImages: true }) };
  }
}

export const listingsService = new ListingsService();
