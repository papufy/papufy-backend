import { Router } from "express";
import { env } from "../config/env";
import { listingsService } from "../services/listings.service";
import { notificationsService } from "../services/notifications.service";

export const internalRoutes = Router();

function assertCronSecret(req: {
  headers: Record<string, unknown>;
}): { ok: true } | { ok: false; status: number; error: string } {
  const expected = env.CRON_SECRET;
  if (!expected) {
    return {
      ok: false,
      status: 503,
      error: "CRON_SECRET não configurado no ambiente.",
    };
  }
  const provided = String(req.headers["x-cron-secret"] ?? "").trim();
  if (!provided || provided !== expected) {
    return { ok: false, status: 401, error: "Unauthorized" };
  }
  return { ok: true };
}

internalRoutes.post("/expire-listings", async (req, res, next) => {
  try {
    const auth = assertCronSecret(req);
    if (!auth.ok) {
      res.status(auth.status).json({ error: auth.error });
      return;
    }

    // Avisos → fecha vencidos → apaga sem renovação (após 17 dias).
    const reminders = await notificationsService.sendListingExpiryReminders();
    const expired = await listingsService.expireOpenListings();
    const purged = await listingsService.purgeStaleListings();
    res.json({ ok: true, reminders, ...expired, ...purged });
  } catch (err) {
    next(err);
  }
});
