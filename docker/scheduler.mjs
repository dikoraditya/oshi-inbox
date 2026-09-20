// In-container replacement for Vercel Cron (vercel.json is Vercel-only).
//
// It pings the app's own cron routes on the same schedule the platform used:
//   - /api/cron/drain        every 15 min  — Gmail sweep + translate backlog
//   - /api/cron/renew-watch  daily ~04:00Z — only when Gmail push is configured
//
// The routes require `Authorization: Bearer $CRON_SECRET` in production, so this
// only does anything useful when CRON_SECRET is set (entrypoint.sh enforces it).

const SECRET = process.env.CRON_SECRET;
const BASE = `http://127.0.0.1:${process.env.PORT || 3000}`;
const headers = { authorization: `Bearer ${SECRET}` };

async function hit(path) {
  try {
    const res = await fetch(`${BASE}${path}`, { headers });
    console.log(`[cron] ${path} -> ${res.status}`);
  } catch (err) {
    console.error(`[cron] ${path} failed:`, err?.message ?? err);
  }
}

// drain: every 15 minutes.
setInterval(() => hit("/api/cron/drain"), 15 * 60 * 1000);

// renew-watch: Gmail-only. Poll hourly, fire once per UTC day around 04:00.
if (process.env.GMAIL_PUBSUB_TOPIC) {
  let lastRenew = null;
  setInterval(() => {
    const now = new Date();
    const day = now.toISOString().slice(0, 10);
    if (now.getUTCHours() === 4 && lastRenew !== day) {
      lastRenew = day;
      hit("/api/cron/renew-watch");
    }
  }, 60 * 60 * 1000);
}

console.log("[cron] scheduler started");
