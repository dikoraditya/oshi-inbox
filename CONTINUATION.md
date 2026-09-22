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
- **One member per (idol, method).** An idol reachable on several apps — e.g.
  Ito Momoka and Mizuki Yamauchi on Weverse DM *and* AKB Mobile Mail — is a
  separate member per source, so the inbox and Statistics list the two apart.
  `resolveOrCreateMemberByEmail` only name-matches within the same source, so
  registering a mobame sender never merges into someone's Weverse member.
  Per-sender mobame backfill: `POST /api/gmail/sync { from, days, max }`.
- **Mobame carry their real send time.** Gmail ingest stores the mail's
  `internalDate` as `createdAt` (not ingest time), so inbox/threads sort by when
  a message was actually sent and each row shows its date (HH:MM today, else
  "Mon D") — matching the collector sources.

## Known issues / next steps
1. **Media storage — resolved (local disk option).** `storeImage` now goes
   through `src/lib/server/media.ts` (`storeMedia`), which writes to
   `public/media/` on disk when `MEDIA_STORAGE=local` or no `BLOB_READ_WRITE_TOKEN`
   is set — free + unlimited for local use, full image/video playback (static
   serving answers HTTP range requests, so `<video>` scrubbing works). Set
   `MEDIA_STORAGE=blob` on Vercel, or `MEDIA_STORAGE=both` to mirror to Blob +
   disk (canonical copy chosen by `MEDIA_PRIMARY`, default `blob`). To reclaim
   the ~227 Nogizaka rows that went
   blank against the full 1 GB Blob: switch to local, delete those blank rows +
   reset the Nogizaka watermark (collector `state.json`) + re-collect. The app
   also runs against a local Postgres now (`DB_DRIVER=pg` or a localhost
   `DATABASE_URL`), so a fully cloud-free local run needs only Postgres +
   `ANTHROPIC_API_KEY`.
2. **COSM** unreachable from non-Japan networks (TCP blocked). Works when the app is
   deployed / on an allowed network.
3. **Weverse video/audio** are poster-only — Weverse gives only a `videoId`, no stream.
4. **Sessions are per-machine.** The collector's Chrome logins (Weverse/Nogizaka) and its
   `state.json` watermarks don't transfer — log in again on the PC (data dedupes in Neon).

## Set up on a new machine (PC)
Copy your secrets across first — `.env.local` (this repo) and `collector/.env` are **not**
in git. Bring them from the Mac (they hold the working DATABASE_URL, keys, etc.), or fill
`.env.example`. Required app vars: `DATABASE_URL`, `ANTHROPIC_API_KEY`, `TRANSLATE_MODEL`,
`FAN_NICKNAME`, `INGEST_SECRET`, `BSTAGE_EMAIL`/`BSTAGE_PASSWORD`, `COSM_*`. Optional:
`BLOB_READ_WRITE_TOKEN` (only for `MEDIA_STORAGE=blob`/Vercel — local disk otherwise),
`DB_DRIVER`/`MEDIA_STORAGE`/`MEDIA_DIR` (driver + storage overrides). Collector vars:
`INGEST_URL`, `INGEST_SECRET`, `COLLECT_SOURCES`,
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

## Docker / self-host deploy (latest session)
Runs the whole app as one container against a bundled Postgres — for SumoPod, and
for a fully local run with no cloud. Files: `Dockerfile`, `docker-compose.yml`,
`.dockerignore`, `docker/` (entrypoint + cron scheduler), `.env.sumopod.example`,
`db/seed-groups.sql`.
- **Dockerfile**: multi-stage → Next.js standalone (`output: "standalone"` in
  `next.config.ts`), non-root user, `entrypoint.sh` backgrounds an in-container
  cron scheduler (`docker/scheduler.mjs`, replaces Vercel Cron) then runs
  `node server.js`. Only starts the scheduler when `CRON_SECRET` is set.
- **docker-compose.yml**: `app` + `postgres:17-alpine` + volumes (`pg_data`,
  `media_data` at `/app/public/media`). The standalone image can't run
  `npm run db:push` (no `tsx`/`src`), so Postgres auto-applies `db/schema.sql`
  then `db/seed-groups.sql` via `/docker-entrypoint-initdb.d` on a **fresh
  volume only**. `POSTGRES_INITDB_ARGS=--encoding=UTF8` keeps the multibyte group
  names (≒JOY, ≠ME, =LOVE) matching Neon. `db:push` remains the path for
  existing/Neon databases.
- **Run it (also the SumoPod reference topology):**
  ```bash
  cp .env.sumopod.example .env    # fill POSTGRES_PASSWORD, APP_PASSWORD,
                                  # CRON_SECRET, INGEST_SECRET, ANTHROPIC_API_KEY, …
  docker compose up -d --build    # app on http://localhost:3000
  docker compose logs db          # expect 01-schema + 02-seed-groups ran once
  ```
  `DB_DRIVER=pg`, `MEDIA_STORAGE=local`, `MEDIA_DIR` are set in compose; on
  SumoPod (no compose) set them on the app container plus `DATABASE_URL`.
- **Not yet run end-to-end**: Docker isn't installed on the current dev machine,
  so `docker compose up` is unverified. YAML + idempotent SQL were reviewed;
  verify on a Docker host with the `logs db` check above.

## SumoPod data + media migration (fully-local self-host)
The self-host stack (`docker-compose.yml`) runs a **bundled Postgres** with media on
a `media_data` volume — it does **not** read Neon/Blob. So a self-hosted box needs the
data *and* the media files copied in; otherwise images 404 ("can't be opened") because
the volume is empty. The one-time migration off cloud:

1. **Normalise the source DB to fully-local URLs** (run once, from a machine whose
   `public/media` holds every file — `npm run media:mirror-local` first if not):
   ```bash
   npm run media:mirror-local     # pull any Blob-only files down to public/media
   npm run media:relink-local     # rewrite every Blob URL row -> /media/... (messages + avatars)
   ```
   After this the DB has **no** `…blob.vercel-storage.com` URLs — all `/media/…`.
2. **Generate the two hand-off artifacts** (both git-ignored — `data.sql` holds private
   DM text, the tarball is ~3.6 GB):
   ```bash
   npx tsx --env-file=.env.local scripts/dump-data.ts   # -> db/data.sql (groups+members+messages, ON CONFLICT DO UPDATE)
   tar -czf media.tar.gz -C public media                # -> media.tar.gz (rooted at media/)
   ```
   `db:dump` uses `DATABASE_URL`; point it at the source DB. The dump upserts, so
   re-loading **repairs** drifted rows (e.g. old Blob URLs) instead of skipping them.
3. **Copy `db/data.sql` + `media.tar.gz` to the SumoPod host** (scp/upload), beside the
   repo, with the compose stack up (`docker compose up -d --build`). Load both:
   ```bash
   # DB — schema + seed-groups already applied by the image's init hook on a fresh volume
   docker compose exec -T db psql -U oshi -d oshi < db/data.sql

   # Media — extract into the media_data volume. Confirm the volume name first:
   docker volume ls        # expect <project>_media_data, e.g. oshi-inbox_media_data
   docker run --rm -v oshi-inbox_media_data:/vol -v "$PWD":/src:ro \
     alpine sh -c 'cd /vol && tar xzf /src/media.tar.gz --strip-components=1'
   ```
   `--strip-components=1` drops the tarball's top `media/` dir so files land at
   `/vol/ingest/…` = the container's `/app/public/media/ingest/…`. Next serves them as
   `/media/*` static files (range requests work → `<video>`/`<audio>` scrub).
   Alternative without a helper container:
   ```bash
   docker compose cp media.tar.gz app:/tmp/media.tar.gz
   docker compose exec app sh -c 'cd /app/public && tar xzf /tmp/media.tar.gz && rm /tmp/media.tar.gz'
   ```
4. **Verify**: open the app — every thumbnail/photo/video loads. Spot-check a `/media/…`
   URL directly (e.g. `https://<host>/media/ingest/nogizaka-163253.jpeg`) returns 200.
   Starting over from scratch: `docker compose down -v && docker compose up -d --build`
   (re-applies schema + seed-groups on the fresh volume), then repeat steps 3.

## Sharing context across devices
- **Data**: already shared — Neon Postgres + Vercel Blob are cloud. Same `.env.local` →
  same inbox on any machine. No sync needed.
- **Code**: these two GitHub repos.
- **Config/secrets**: copy `.env.local` + `collector/.env` between machines (git-ignored).
- **This omp conversation**: lives locally in `~/.omp/agent/sessions/` (per machine). To
  continue the assistant on the PC, run `omp` inside the cloned repo — it reads this file.
  To carry the exact chat, copy the session `.jsonl` and `omp --resume <id>`.
