import {
  normalizeListingType,
  type ListingStatus,
  type ListingType,
} from "../types/enums";
import { assertNoError, newId, supabase } from "../lib/db";
import {
  reputationService,
  type UserReputation,
} from "./reputation.service";
import { sanitizePhone, sanitizeText } from "../utils/sanitize";
import { AppError, badRequest, forbidden } from "../utils/errors";
import { publicFileUrl } from "../middleware/upload";
import { resolvePriceFields } from "../utils/priceRange";
import {
  addListingTtlDays,
  computeRenewedExpiresAt,
  LISTING_PURGE_GRACE_DAYS,
} from "../constants/listingTtl";
import type { Database, Tables } from "../types/database";

type ListingPatch = Database["public"]["Tables"]["Listing"]["Update"];

export interface ListListingsFilters {
  search?: string;
  category?: string;
  /** Múltiplas categorias (pedido + profissionais afins). */
  categories?: string[];
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
  precoMin?: number | null;
  precoMax?: number | null;
  aCombinar: boolean;
  diferenciais?: string | null;
  categoria: string;
  semQualificacao?: boolean;
  status: ListingStatus;
  archivedAt?: string | null;
  expiresAt?: string | null;
  expiredByTtl?: boolean;
  cep: string | null;
  cidade: string;
  bairro: string | null;
  uf: string;
  telefone: string;
  createdAt: string;
  User?: {
    id: string;
    nome: string;
    cidade: string | null;
    uf: string | null;
    fotoUrl?: string | null;
    createdAt?: string;
    updatedAt?: string;
    telefone?: string | null;
    email?: string | null;
  };
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

  const listingType = normalizeListingType(listing.tipo) ?? listing.tipo;
  const isJobVacancy = listingType === "JOB_VACANCY";

  return {
    id: listing.id,
    userId: listing.userId,
    listingType,
    titulo: listing.titulo,
    descricao: listing.descricao,
    preco: listing.preco,
    precoMin: listing.precoMin ?? listing.preco,
    precoMax: listing.precoMax ?? listing.preco,
    aCombinar: listing.aCombinar,
    diferenciais: listing.diferenciais ?? null,
    categoria: listing.categoria,
    semQualificacao: isJobVacancy ? listing.semQualificacao ?? false : false,
    status: listing.status,
    expiresAt: listing.expiresAt ?? null,
    expiredByTtl: listing.expiredByTtl ?? false,
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
    const listing = assertNoError<
      Pick<Tables<"Listing">, "id" | "userId" | "aCombinar" | "tipo" | "semQualificacao">
    >(
      await supabase
        .from("Listing")
        .select("id, userId, aCombinar, tipo, semQualificacao")
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

    const status = filters.status ?? "OPEN";
    let query = supabase
      .from("Listing")
      .select(LISTING_LIST_SELECT, { count: "exact" })
      .eq("status", status);

    // Feed público: só OPEN ainda dentro da validade (defesa contra race do cron).
    if (status === "OPEN") {
      query = query.gt("expiresAt", new Date().toISOString());
    }

    if (filters.tipo) {
      query = query.eq("tipo", filters.tipo);
    }

    if (filters.categories && filters.categories.length > 0) {
      query = query.in("categoria", filters.categories);
    } else if (filters.category) {
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
          `*, User!Listing_userId_fkey(id, nome, cidade, uf, fotoUrl, createdAt, updatedAt, telefone, email), images:ListingImage(id, url, ordem)`
        )
        .eq("id", id)
        .maybeSingle(),
      "Anúncio não encontrado."
    ) as ListingRow;

    if (listing.archivedAt) {
      throw new AppError("Anúncio não encontrado.", 404);
    }

    const isOwner = viewerId === listing.userId;
    if (!isOwner) {
      if (listing.status === "CLOSED") {
        throw new AppError("Anúncio não encontrado.", 404);
      }
      if (listing.status === "OPEN") {
        const expiresAt = listing.expiresAt
          ? new Date(listing.expiresAt).getTime()
          : 0;
        if (expiresAt > 0 && expiresAt <= Date.now()) {
          throw new AppError("Anúncio não encontrado.", 404);
        }
      }
    }
    let reputation: UserReputation = {
      averageRating: null,
      reviewCount: 0,
      completedJobsCount: 0,
    };
    try {
      reputation = await reputationService.getForUser(listing.userId);
    } catch {
      /* reputação indisponível — não bloqueia o anúncio */
    }
    const mapped = mapListing(listing, { includePhone: isOwner, allImages: true });
    const publisher = listing.User;

    return {
      listing: {
        ...mapped,
        criador: publisher
          ? {
              id: publisher.id,
              nome: publisher.nome,
              cidade: publisher.cidade,
              uf: publisher.uf,
              fotoUrl: publisher.fotoUrl ?? null,
              memberSince: publisher.createdAt,
              lastSeenAt: publisher.updatedAt,
              verifiedEmail: Boolean(publisher.email),
              verifiedPhone: Boolean(publisher.telefone),
              reputation,
            }
          : undefined,
        isOwner,
      },
    };
  }

  async listPublicByUser(
    userId: string,
    options?: { limit?: number; offset?: number }
  ) {
    const limit = Math.min(Math.max(options?.limit ?? 12, 1), 24);
    const offset = Math.max(options?.offset ?? 0, 0);

    const { data, error, count } = await supabase
      .from("Listing")
      .select(LISTING_LIST_SELECT, { count: "exact" })
      .eq("userId", userId)
      .eq("status", "OPEN")
      .gt("expiresAt", new Date().toISOString())
      .is("archivedAt", null)
      .order("createdAt", { ascending: false })
      .range(offset, offset + limit - 1);

    if (error) {
      const err = new Error(error.message);
      (err as Error & { statusCode: number }).statusCode = 500;
      throw err;
    }

    const items = (data ?? []) as ListingRow[];
    return {
      listings: items.map((l) => mapListing(l)),
      total: count ?? items.length,
      limit,
      offset,
    };
  }

  async create(
    userId: string,
    data: {
      tipo: ListingType;
      titulo: string;
      descricao: string;
      preco?: number | null;
      precoMin?: number | null;
      precoMax?: number | null;
      aCombinar: boolean;
      diferenciais?: string | null;
      categoria: string;
      cep?: string;
      cidade: string;
      bairro?: string;
      uf: string;
      telefone: string;
      semQualificacao?: boolean;
      imagePaths?: string[];
    }
  ) {
    const listingId = newId();
    const price = resolvePriceFields(data);
    const expiresAt = addListingTtlDays(new Date()).toISOString();

    const listing = assertNoError(
      await supabase
        .from("Listing")
        .insert({
          id: listingId,
          userId,
          tipo: data.tipo,
          titulo: sanitizeText(data.titulo, 120),
          descricao: sanitizeText(data.descricao, 4000),
          preco: price.preco,
          precoMin: price.precoMin,
          precoMax: price.precoMax,
          aCombinar: price.aCombinar,
          diferenciais: data.diferenciais
            ? sanitizeText(data.diferenciais, 2000)
            : null,
          categoria: sanitizeText(data.categoria || "Geral", 80),
          semQualificacao: data.semQualificacao ?? false,
          cep: data.cep ? sanitizeText(data.cep, 12) : null,
          cidade: sanitizeText(data.cidade, 80),
          bairro: data.bairro ? sanitizeText(data.bairro, 80) : null,
          uf: data.uf.toUpperCase(),
          telefone: sanitizePhone(data.telefone),
          expiresAt,
          expiredByTtl: false,
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

  async listMine(userId: string) {
    const { data, error } = await supabase
      .from("Listing")
      .select(LISTING_LIST_SELECT)
      .eq("userId", userId)
      .is("archivedAt", null)
      .order("createdAt", { ascending: false });

    if (error) {
      const err = new Error(error.message);
      (err as Error & { statusCode: number }).statusCode = 500;
      throw err;
    }

    const items = (data ?? []) as ListingRow[];
    return {
      listings: items.map((l) => mapListing(l, { includePhone: true })),
      total: items.length,
    };
  }

  async update(
    listingId: string,
    userId: string,
    data: {
      titulo?: string;
      descricao?: string;
      preco?: number | null;
      precoMin?: number | null;
      precoMax?: number | null;
      aCombinar?: boolean;
      diferenciais?: string | null;
      cidade?: string;
      bairro?: string | null;
      cep?: string | null;
      uf?: string;
      telefone?: string;
      semQualificacao?: boolean;
    }
  ) {
    const current = await this.assertOwner(listingId, userId);

    const patch: ListingPatch = {
      updatedAt: new Date().toISOString(),
    };

    if (data.titulo !== undefined) {
      patch.titulo = sanitizeText(data.titulo, 120);
    }
    if (data.descricao !== undefined) {
      patch.descricao = sanitizeText(data.descricao, 4000);
    }

    const priceTouched =
      data.aCombinar !== undefined ||
      data.preco !== undefined ||
      data.precoMin !== undefined ||
      data.precoMax !== undefined;

    if (priceTouched) {
      const price = resolvePriceFields({
        aCombinar: data.aCombinar ?? current.aCombinar,
        preco: data.preco,
        precoMin: data.precoMin,
        precoMax: data.precoMax,
      });
      patch.preco = price.preco;
      patch.precoMin = price.precoMin;
      patch.precoMax = price.precoMax;
      patch.aCombinar = price.aCombinar;
    }

    if (data.diferenciais !== undefined) {
      patch.diferenciais = data.diferenciais
        ? sanitizeText(data.diferenciais, 2000)
        : null;
    }
    if (data.cidade !== undefined) {
      patch.cidade = sanitizeText(data.cidade, 80);
    }
    if (data.bairro !== undefined) {
      patch.bairro = data.bairro ? sanitizeText(data.bairro, 80) : null;
    }
    if (data.cep !== undefined) {
      patch.cep = data.cep ? sanitizeText(data.cep, 12) : null;
    }
    if (data.uf !== undefined) {
      patch.uf = data.uf.toUpperCase();
    }
    if (data.telefone !== undefined) {
      patch.telefone = sanitizePhone(data.telefone);
    }
    if (data.semQualificacao !== undefined) {
      patch.semQualificacao =
        current.tipo === "JOB_VACANCY" ? data.semQualificacao : false;
    } else if (current.tipo === "PROFESSIONAL_PROFILE" && current.semQualificacao) {
      // Limpa flag legada em perfis profissionais.
      patch.semQualificacao = false;
    }

    const updated = assertNoError(
      await supabase
        .from("Listing")
        .update(patch)
        .eq("id", listingId)
        .select(
          `*, User!Listing_userId_fkey(id, nome, cidade, uf), images:ListingImage(id, url, ordem)`
        )
        .single()
    ) as ListingRow;

    return { listing: mapListing(updated, { includePhone: true, allImages: true }) };
  }

  async close(listingId: string, userId: string) {
    await this.assertOwner(listingId, userId);
    const updated = assertNoError(
      await supabase
        .from("Listing")
        .update({
          status: "CLOSED" as ListingStatus,
          expiredByTtl: false,
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

  async reopen(listingId: string, userId: string) {
    await this.assertOwner(listingId, userId);
    const current = assertNoError<
      Pick<Tables<"Listing">, "id" | "expiresAt" | "status">
    >(
      await supabase
        .from("Listing")
        .select("id, expiresAt, status")
        .eq("id", listingId)
        .maybeSingle(),
      "Anúncio não encontrado."
    );

    const expiresAt = current.expiresAt
      ? new Date(current.expiresAt).getTime()
      : 0;
    if (!expiresAt || expiresAt <= Date.now()) {
      throw badRequest(
        "Anúncio expirado. Para reabrir, renove por R$ 15 e ganhe mais 15 dias."
      );
    }

    const updated = assertNoError(
      await supabase
        .from("Listing")
        .update({
          status: "OPEN" as ListingStatus,
          expiredByTtl: false,
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

  /** Cron: OPEN com expiresAt vencido → CLOSED + expiredByTtl. */
  async expireOpenListings(): Promise<{ expired: number }> {
    const now = new Date().toISOString();
    const { data, error } = await supabase
      .from("Listing")
      .update({
        status: "CLOSED" as ListingStatus,
        expiredByTtl: true,
        updatedAt: now,
      })
      .eq("status", "OPEN")
      .lte("expiresAt", now)
      .select("id");

    if (error) {
      const err = new Error(error.message);
      (err as Error & { statusCode: number }).statusCode = 500;
      throw err;
    }

    return { expired: data?.length ?? 0 };
  }

  /**
   * Apaga anúncios sem renovação após validade + graça (15+2 = 17 dias).
   * Não remove anúncios com Transaction (histórico financeiro).
   */
  async purgeStaleListings(): Promise<{ purged: number; skippedWithTx: number }> {
    const cutoff = new Date();
    cutoff.setUTCDate(cutoff.getUTCDate() - LISTING_PURGE_GRACE_DAYS);
    const cutoffIso = cutoff.toISOString();

    const { data: candidates, error } = await supabase
      .from("Listing")
      .select("id")
      .not("expiresAt", "is", null)
      .lte("expiresAt", cutoffIso)
      .neq("status", "IN_PROGRESS")
      .limit(200);

    if (error) {
      const err = new Error(error.message);
      (err as Error & { statusCode: number }).statusCode = 500;
      throw err;
    }

    let purged = 0;
    let skippedWithTx = 0;

    for (const row of candidates ?? []) {
      const { count: txCount, error: txErr } = await supabase
        .from("Transaction")
        .select("id", { count: "exact", head: true })
        .eq("listingId", row.id);

      if (txErr) {
        console.warn("[purge] transaction check:", txErr.message);
        continue;
      }

      if ((txCount ?? 0) > 0) {
        skippedWithTx += 1;
        continue;
      }

      // Imagens e demais FKs em cascade; remove imagens explicitamente por segurança.
      await supabase.from("ListingImage").delete().eq("listingId", row.id);
      const { error: delErr } = await supabase
        .from("Listing")
        .delete()
        .eq("id", row.id);

      if (delErr) {
        console.warn(`[purge] listing ${row.id}:`, delErr.message);
        continue;
      }
      purged += 1;
    }

    return { purged, skippedWithTx };
  }

  /** Após PIX de renovação pago: +15 dias e reabre se estava CLOSED. */
  async applyPaidRenewal(listingId: string): Promise<void> {
    const listing = assertNoError<
      Pick<Tables<"Listing">, "id" | "expiresAt" | "status">
    >(
      await supabase
        .from("Listing")
        .select("id, expiresAt, status")
        .eq("id", listingId)
        .maybeSingle(),
      "Anúncio não encontrado."
    );

    const expiresAt = computeRenewedExpiresAt(listing.expiresAt).toISOString();
    await supabase
      .from("Listing")
      .update({
        expiresAt,
        status: "OPEN" as ListingStatus,
        expiredByTtl: false,
        updatedAt: new Date().toISOString(),
      })
      .eq("id", listingId);
  }

  async remove(listingId: string, userId: string) {
    await this.assertOwner(listingId, userId);
    const { error: imgError } = await supabase
      .from("ListingImage")
      .delete()
      .eq("listingId", listingId);
    if (imgError) {
      const err = new Error(imgError.message);
      (err as Error & { statusCode: number }).statusCode = 500;
      throw err;
    }
    const { error } = await supabase.from("Listing").delete().eq("id", listingId);
    if (error) {
      const err = new Error(error.message);
      (err as Error & { statusCode: number }).statusCode = 500;
      throw err;
    }
  }
}

export const listingsService = new ListingsService();
