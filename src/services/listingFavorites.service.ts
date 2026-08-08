import { assertNoError, newId, supabase } from "../lib/db";
import { badRequest } from "../utils/errors";

export class ListingFavoritesService {
  async listIds(userId: string): Promise<string[]> {
    const rows = assertNoError<Array<{ listingId: string }>>(
      await supabase
        .from("ListingFavorite")
        .select("listingId")
        .eq("userId", userId)
        .order("createdAt", { ascending: false })
    );
    return rows.map((r) => r.listingId);
  }

  async add(userId: string, listingId: string) {
    const listing = assertNoError<{ id: string }>(
      await supabase
        .from("Listing")
        .select("id")
        .eq("id", listingId)
        .maybeSingle(),
      "Anúncio não encontrado."
    );

    const { data: existing } = await supabase
      .from("ListingFavorite")
      .select("id")
      .eq("userId", userId)
      .eq("listingId", listing.id)
      .maybeSingle();

    if (existing) {
      return { favorited: true as const };
    }

    const { error } = await supabase.from("ListingFavorite").insert({
      id: newId(),
      userId,
      listingId: listing.id,
    });

    if (error) {
      throw badRequest(error.message);
    }

    return { favorited: true as const };
  }

  async remove(userId: string, listingId: string) {
    const { error } = await supabase
      .from("ListingFavorite")
      .delete()
      .eq("userId", userId)
      .eq("listingId", listingId);

    if (error) {
      throw badRequest(error.message);
    }

    return { favorited: false as const };
  }

  async toggle(userId: string, listingId: string) {
    const { data: existing } = await supabase
      .from("ListingFavorite")
      .select("id")
      .eq("userId", userId)
      .eq("listingId", listingId)
      .maybeSingle();

    if (existing) {
      return this.remove(userId, listingId);
    }
    return this.add(userId, listingId);
  }
}

export const listingFavoritesService = new ListingFavoritesService();
