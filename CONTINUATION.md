# Oshi Inbox — continuation notes (device move: Mac → PC)

This file is the hand-off context. The **data lives in the cloud** (Neon Postgres +
Vercel Blob), so a new machine with the same `.env.local` sees the identical inbox —
nothing to migrate. This repo is the **app**; the collector is a separate repo
(`oshi-inbox-collector`).

## What this is
One inbox for idol DMs across platforms, with JP / romaji / English aligned.
- **App** (this repo): Next.js 16 on `localhost:3000`, Neon Postgres, Vercel Blob for
  media, Anthropic for translation. Serves the UI and the server-side "Fetch" sources
  (COSM, NMB b.stage). Deploys to Vercel, but runs fine locally.
- **Collector** (`oshi-inbox-collector` repo): a local Playwright/CDP tool that drives
  your logged-in Chrome to pull the browser-gated sources (Weverse DM, Nogizaka mobame)
  and POSTs them to the app's `/api/ingest`.

## Sources — status
| Source | Path | Works? |
|---|---|---|
| Nogizaka mobame | collector (`collect -- nogizaka`) | ✅ full history, per-member, video+audio play |
| Weverse DM | collector (`collect -- weverse`) | ✅ text+photo; video/audio are poster-only (no stream URL) |
| NMB48 b.stage | app **Fetch** button (server-side) | ✅ latest-per-member; avatars seeded |
| COSM (=LOVE/≠ME/≒JOY) | app **Fetch** button (server-side) | ⚠️ network/geo-blocked from some networks (Japan-only) |
| Gmail (AKB mobame) | Pub/Sub webhook (deploy-only) | cloud-only, not used locally |

## What's implemented (this project's work)
- Translation on **Anthropic Haiku** via `TRANSLATE_MODEL` (cheap). Billing/credit errors
  are handled: the message stays `pending` (no error shown) and the drain **pauses**
  instead of failing everything. Top up credit, then run the drain to translate.
- **Profile avatars** auto-captured: Weverse (`dmOfficialImageUrl`), Nogizaka (group
  `thumbnail`), NMB (`creator.avatarImgPath`). COSM has none (no field + blocked).
- **Edit Profile** screen (Edit button in a thread): name, avatar (URL or upload), blog
  link, and email (routes Gmail mobame to that member).
- Inbox sorted newest-first, shows the latest message **date** (not "new"), media-aware
  preview ("Photo"/"Video"/"Audio"); thread is newest-first with an avatar header.
- Media: `<video>`/`<audio>` players; images shown whole (uncropped) up to 560px.
- Nogizaka `%%%` fan-name placeholder is substituted with `FAN_NICKNAME` (set to "Diko").
- Collector ingest is resilient: dedupe **before** the media copy, small batches + retry,
  per-page watermark persistence, newest-first bounded Weverse paging.

## Known issues / next steps
1. **Media storage cap.** Vercel Blob free tier = **1 GB**, and it's full (videos), so
   ~227 Nogizaka messages have media that couldn't be stored → they render blank.
   Options: (a) switch `storeImage` (`src/lib/server/ingest.ts`) to save under a local
   folder like `public/media/` — free + unlimited for local use, full playback; or
   (b) upgrade Vercel Blob to Pro. **Decision deferred.** If going local-disk: change
   `storeImage`, then delete the blank rows + reset the Nogizaka watermark + re-collect.
2. **COSM** unreachable from non-Japan networks (TCP blocked). Works when the app is
   deployed / on an allowed network.
3. **Weverse video/audio** are poster-only — Weverse gives only a `videoId`, no stream.
4. **Sessions are per-machine.** The collector's Chrome logins (Weverse/Nogizaka) and its
   `state.json` watermarks don't transfer — log in again on the PC (data dedupes in Neon).

## Set up on a new machine (PC)
Copy your secrets across first — `.env.local` (this repo) and `collector/.env` are **not**
in git. Bring them from the Mac (they hold the working DATABASE_URL, keys, etc.), or fill
`.env.example`. Required app vars: `DATABASE_URL`, `ANTHROPIC_API_KEY`, `TRANSLATE_MODEL`,
`FAN_NICKNAME`, `BLOB_READ_WRITE_TOKEN`, `INGEST_SECRET`, `BSTAGE_EMAIL`/`BSTAGE_PASSWORD`,
`COSM_*`. Collector vars: `INGEST_URL`, `INGEST_SECRET`, `COLLECT_SOURCES`,
`WEVERSE_ROOM_IDS`, `CDP_URL`.

```bash
# --- app (this repo) ---
npm install
# put your .env.local in place (copied from Mac, or from .env.example)
npm run db:push          # idempotent; schema already applied to the shared Neon DB
npm run db:seed-bstage   # NMB roster + avatars
npm run dev              # http://localhost:3000

# --- collector (oshi-inbox-collector repo) ---
npm install
npx playwright install chromium
# put your collector/.env in place
npm run login -- nogizaka weverse   # opens a browser to log in once
npm run collect -- nogizaka weverse
```

Collector auth note: it drives a Chrome with `--remote-debugging-port=9222`. On the PC,
launch Chrome once with that flag + a dedicated profile, log into weverse.io and
message.nogizaka46.com, then run `npm run collect`. See the collector README.

## Sharing context across devices
- **Data**: already shared — Neon Postgres + Vercel Blob are cloud. Same `.env.local` →
  same inbox on any machine. No sync needed.
- **Code**: these two GitHub repos.
- **Config/secrets**: copy `.env.local` + `collector/.env` between machines (git-ignored).
- **This omp conversation**: lives locally in `~/.omp/agent/sessions/` (per machine). To
  continue the assistant on the PC, run `omp` inside the cloned repo — it reads this file.
  To carry the exact chat, copy the session `.jsonl` and `omp --resume <id>`.
