import { assertNoError, newId, supabase } from "../lib/db";
import type { Tables } from "../types/database";
import { forbidden } from "../utils/errors";
import {
  addBrazilDays,
  brazilDayBoundsIso,
  getBrazilYmd,
} from "../utils/brazilDate";

export type AppNotificationType =
  | "LISTING_EXPIRES_TOMORROW"
  | "LISTING_EXPIRES_TODAY";

type NotificationRow = Tables<"AppNotification">;

export class NotificationsService {
  async listForUser(userId: string, limit = 50) {
    const safeLimit = Math.min(Math.max(limit, 1), 100);
    const { data, error } = await supabase
      .from("AppNotification")
      .select("*")
      .eq("userId", userId)
      .order("createdAt", { ascending: false })
      .limit(safeLimit);

    if (error) {
      const err = new Error(error.message);
      (err as Error & { statusCode: number }).statusCode = 500;
      throw err;
    }

    return { notifications: (data ?? []) as NotificationRow[] };
  }

  async unreadCount(userId: string): Promise<{ count: number }> {
    const { count, error } = await supabase
      .from("AppNotification")
      .select("id", { count: "exact", head: true })
      .eq("userId", userId)
      .is("readAt", null);

    if (error) {
      const err = new Error(error.message);
      (err as Error & { statusCode: number }).statusCode = 500;
      throw err;
    }

    return { count: count ?? 0 };
  }

  async markRead(notificationId: string, userId: string) {
    const row = assertNoError<Pick<NotificationRow, "id" | "userId" | "readAt">>(
      await supabase
        .from("AppNotification")
        .select("id, userId, readAt")
        .eq("id", notificationId)
        .maybeSingle(),
      "Notificação não encontrada."
    );

    if (row.userId !== userId) {
      throw forbidden("Sem permissão.");
    }

    if (row.readAt) {
      return { notification: row };
    }

    const updated = assertNoError<NotificationRow>(
      await supabase
        .from("AppNotification")
        .update({ readAt: new Date().toISOString() })
        .eq("id", notificationId)
        .select()
        .single()
    );

    return { notification: updated };
  }

  async markAllRead(userId: string): Promise<{ updated: number }> {
    const now = new Date().toISOString();
    const { data, error } = await supabase
      .from("AppNotification")
      .update({ readAt: now })
      .eq("userId", userId)
      .is("readAt", null)
      .select("id");

    if (error) {
      const err = new Error(error.message);
      (err as Error & { statusCode: number }).statusCode = 500;
      throw err;
    }

    return { updated: data?.length ?? 0 };
  }

  private async createIfAbsent(input: {
    userId: string;
    listingId: string;
    type: AppNotificationType;
    title: string;
    body: string;
    href: string;
    refExpiresAt: string;
  }): Promise<boolean> {
    const { data: existing } = await supabase
      .from("AppNotification")
      .select("id")
      .eq("listingId", input.listingId)
      .eq("type", input.type)
      .eq("refExpiresAt", input.refExpiresAt)
      .maybeSingle();

    if (existing?.id) return false;

    const { error } = await supabase.from("AppNotification").insert({
      id: newId(),
      userId: input.userId,
      listingId: input.listingId,
      type: input.type,
      title: input.title,
      body: input.body,
      href: input.href,
      refExpiresAt: input.refExpiresAt,
      createdAt: new Date().toISOString(),
    });

    // corrida com unique index
    if (error) {
      if (error.code === "23505") return false;
      console.warn("[notifications] insert falhou:", error.message);
      return false;
    }

    return true;
  }

  private async notifyOpenListingsInRange(
    type: AppNotificationType,
    startIso: string,
    endIso: string
  ): Promise<number> {
    const { data, error } = await supabase
      .from("Listing")
      .select("id, userId, titulo, expiresAt")
      .eq("status", "OPEN")
      .is("archivedAt", null)
      .gte("expiresAt", startIso)
      .lte("expiresAt", endIso);

    if (error) {
      console.warn("[notifications] listagem falhou:", error.message);
      return 0;
    }

    let created = 0;
    for (const listing of data ?? []) {
      if (!listing.expiresAt) continue;
      const title =
        type === "LISTING_EXPIRES_TOMORROW"
          ? "Seu anúncio expira amanhã"
          : "Seu anúncio expira hoje";
      const body =
        type === "LISTING_EXPIRES_TOMORROW"
          ? `"${listing.titulo}" sai do ar amanhã. Se quiser manter, renove por R$ 15 e ganhe mais 15 dias.`
          : `"${listing.titulo}" expira hoje. Se quiser manter, renove por R$ 15 no Pix.`;

      const ok = await this.createIfAbsent({
        userId: listing.userId,
        listingId: listing.id,
        type,
        title,
        body,
        href: `/anuncio/${listing.id}`,
        refExpiresAt: listing.expiresAt,
      });
      if (ok) created += 1;
    }

    return created;
  }

  /**
   * Cron diário: avisa 1 dia antes e no dia da expiração (fuso SP).
   */
  async sendListingExpiryReminders(): Promise<{
    tomorrow: number;
    today: number;
  }> {
    const todayYmd = getBrazilYmd();
    const tomorrowYmd = addBrazilDays(todayYmd, 1);
    const todayBounds = brazilDayBoundsIso(todayYmd);
    const tomorrowBounds = brazilDayBoundsIso(tomorrowYmd);

    const tomorrow = await this.notifyOpenListingsInRange(
      "LISTING_EXPIRES_TOMORROW",
      tomorrowBounds.start,
      tomorrowBounds.end
    );
    const today = await this.notifyOpenListingsInRange(
      "LISTING_EXPIRES_TODAY",
      todayBounds.start,
      todayBounds.end
    );

    return { tomorrow, today };
  }
}

export const notificationsService = new NotificationsService();
