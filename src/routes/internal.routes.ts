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

/**
 * Probe: tenta criar recebedor mínimo e interpreta o status.
 * - 412 + split/forbidden → Marketplace ainda bloqueado
 * - 400/422 (validação) → Marketplace liberado (só faltaram dados)
 * - 200/201 → liberado
 */
internalRoutes.get("/pagarme-marketplace-status", async (req, res, next) => {
  try {
    const auth = assertCronSecret(req);
    if (!auth.ok) {
      res.status(auth.status).json({ error: auth.error });
      return;
    }

    if (!env.PAGARME_SECRET_KEY) {
      res.status(503).json({
        ok: false,
        marketplaceEnabled: false,
        reason: "PAGARME_SECRET_KEY ausente",
      });
      return;
    }

    const authHeader = `Basic ${Buffer.from(
      `${env.PAGARME_SECRET_KEY}:`,
      "utf8"
    ).toString("base64")}`;
    const base = env.PAGARME_API_URL.replace(/\/$/, "");

    const listRes = await fetch(`${base}/recipients?page=1&size=1`, {
      headers: {
        Accept: "application/json",
        Authorization: authHeader,
      },
    });
    const listText = await listRes.text();

    const probeRes = await fetch(`${base}/recipients`, {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
        Authorization: authHeader,
      },
      body: JSON.stringify({
        code: `probe-${Date.now()}`,
        register_information: {
          name: "Probe Marketplace",
          email: "probe@papufy.com",
          document: "00000000000",
          type: "individual",
        },
      }),
    });
    const probeText = await probeRes.text();
    let probeJson: Record<string, unknown> = {};
    try {
      probeJson = probeText
        ? (JSON.parse(probeText) as Record<string, unknown>)
        : {};
    } catch {
      probeJson = { raw: probeText.slice(0, 300) };
    }

    const probeMessage = String(
      probeJson.message ??
        (typeof probeJson.raw === "string" ? probeJson.raw : "") ??
        ""
    );
    const lower = probeMessage.toLowerCase();
    const blocked =
      probeRes.status === 412 ||
      lower.includes("split setting") ||
      lower.includes("not allowed to create a recipient") ||
      lower.includes("action_forbidden");

    const validationOnly =
      !blocked &&
      (probeRes.status === 400 ||
        probeRes.status === 422 ||
        lower.includes("validation") ||
        lower.includes("invalid") ||
        lower.includes("document") ||
        lower.includes("register_information") ||
        lower.includes("bank"));

    const marketplaceEnabled =
      probeRes.status === 200 ||
      probeRes.status === 201 ||
      validationOnly;

    res.json({
      ok: true,
      marketplaceEnabled,
      listStatus: listRes.status,
      listOk: listRes.ok,
      probeStatus: probeRes.status,
      probeMessage: probeMessage.slice(0, 280),
      platformRecipientConfigured: Boolean(env.PAGARME_PLATFORM_RECIPIENT_ID),
      checkedAt: new Date().toISOString(),
      listPreview:
        typeof listText === "string" ? listText.slice(0, 120) : undefined,
    });
  } catch (err) {
    next(err);
  }
});
