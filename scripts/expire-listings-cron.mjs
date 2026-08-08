/**
 * Cron Render: chama POST /internal/expire-listings
 * Env: CRON_SECRET, PUBLIC_BASE_URL (ou API_BASE_URL)
 */
const secret = process.env.CRON_SECRET?.trim();
const base = (
  process.env.PUBLIC_BASE_URL ||
  process.env.API_BASE_URL ||
  "https://papufy-backend.onrender.com"
).replace(/\/$/, "");

if (!secret) {
  console.error("[expire-cron] CRON_SECRET não definido.");
  process.exit(1);
}

const url = `${base}/internal/expire-listings`;
console.log(`[expire-cron] POST ${url}`);

const res = await fetch(url, {
  method: "POST",
  headers: {
    "X-Cron-Secret": secret,
    Accept: "application/json",
  },
});

const text = await res.text();
console.log(`[expire-cron] ${res.status} ${text}`);

if (!res.ok) {
  process.exit(1);
}
