# Oshi Inbox

One inbox for messages from every idol group you follow — Weverse DM, 755 Talk,
niajoy Talk and Mobile Mail — with Japanese, romaji and English aligned line for
line so you can actually read them.

Mail filed into a Gmail label is ingested automatically by webhook, translated,
and waiting for you the next time you open the app.

Built from the `Idol Inbox.dc.html` Claude Design canvas.

---

## Quick start (local, no Gmail)

```bash
npm install
```

Copy the env template (PowerShell: `Copy-Item .env.example .env.local`):

```bash
cp .env.example .env.local
```

Set `DATABASE_URL` and `ANTHROPIC_API_KEY`, then create the schema and seed:

```bash
npm run db:push
```

```bash
npm run dev
```

Leave `APP_PASSWORD` empty locally and the passphrase gate stays off. **Always
set it on a deployment** — the app is a single public URL with your messages
behind it.

### Running fully local (no cloud accounts)

The app runs against cloud services (Neon Postgres + Vercel Blob) or entirely on
your own machine — pick per environment with two env vars, both auto-detected:

- **Database.** Point `DATABASE_URL` at a local Postgres
  (`postgres://postgres:postgres@localhost:5432/oshi`) and it uses the
  node-postgres driver automatically; a Neon URL uses Neon's HTTP driver. Force
  either with `DB_DRIVER=pg` / `DB_DRIVER=neon`. `npm run db:push` and the seed
  scripts follow the same selection.
- **Media (pics + videos).** With no `BLOB_READ_WRITE_TOKEN`, attachments and
  ingested images/videos are written to `public/media/` on disk and served as
  static files — free and unbounded, with full `<video>` playback. Set
  `MEDIA_STORAGE=local` to force disk even when a Blob token is present,
  `MEDIA_STORAGE=blob` on Vercel (whose filesystem is read-only), or
  `MEDIA_STORAGE=both` to mirror every file to Blob **and** disk for redundancy.
  In `both` mode `MEDIA_PRIMARY` (default `blob`) picks which copy's URL is
  stored on the row and served; the other is a backup, and each write is
  best-effort so one backend failing never drops the media. `MEDIA_DIR`
  overrides the folder. `public/media/` is git-ignored.

So a zero-cloud local run needs only a local Postgres and `ANTHROPIC_API_KEY`;
leave the Blob and Vercel vars blank.

---

## How it works

### Reading

Each message renders as up to three stacked blocks — Japanese, romaji, English —
split into sentences independently and numbered in a shared gutter. Tapping line
3 anywhere highlights line 3 in all three blocks at once. English stays hidden
until you press **Show English**.

Vocabulary is underlined in the Japanese; tapping a word opens a gloss above it.
Messages longer than 90 characters clamp to the first two sentences.

Sentence splitting is naive on purpose (`。！？` for Japanese, `.!?` for Latin
script), so the three blocks only line up if the translation preserves sentence
count. The translator is told that explicitly and given the expected count.

### Capture

Pick a member, pick a source, optionally attach a screenshot (paste with ⌘V,
drop, or pick a file), paste the Japanese. Nothing else is typed — romaji,
English and glosses are generated after saving.

On save: unchanged Japanese keeps its translation; changed Japanese clears it and
regenerates. Translation runs server-side in `after()`, so the response returns
immediately and the message shows **Awaiting translation** until it resolves.

### Roster

Groups and members you follow, with an entry count each. Both forms write to the
database: **Add a member** (name + group + source) and **Add a group**. A new
member appears in the inbox immediately, marked as nothing captured yet.

The split matters:

- **Members and groups are data.** Both are tables, so the Roster screen can add
  to them and the inbox buckets by whatever groups exist rather than a hardcoded
  list.
- **Sources are a property.** The four apps are the `SOURCES` constant in
  `types.ts`, because each is a separate integration rather than a label you
  invent. The API rejects an unknown source.

### Gmail ingestion

Gmail publishes changes to your `oshi` label into a Cloud Pub/Sub topic, which
pushes to `/api/gmail/push`. The notification carries only `{emailAddress,
historyId}` — no mail — so the handler walks `users.history.list` from the stored
cursor, fetches each new message, strips it to plain text, pulls the first inline
image into Blob storage, and stores it as `pending`. Translation then runs in
`after()` so Pub/Sub gets its acknowledgement immediately.

**Attribution.** Senders are matched against addresses remembered on each member.
An unrecognised sender lands in the **Unassigned** bucket at the top of the
inbox; filing it once records that address against the member, so everything
after routes itself. That is the entire rules engine.

**Two failure modes are designed around:**

- *Duplicate delivery.* Pub/Sub is at-least-once and Gmail history can replay, so
  the same mail arrives more than once. `gmail_message_id` is unique and inserts
  are `on conflict do nothing`.
- *Silent stoppage.* A Gmail watch expires after 7 days, and nothing anywhere
  reports it — ingestion just stops. A daily cron renews it, and a 15-minute cron
  re-syncs from the cursor and translates any backlog.

Gmail retains history for about a week. If the cursor ages out, ingestion falls
back to listing recent mail in the label — harmless, because of the unique
constraint.

### Storage

Postgres is the source of truth; IndexedDB holds the last snapshot so the app
opens instantly and still renders offline. Writes go to the server, so they fail
while offline rather than queueing.

| Table       | Contents                                                     |
| ----------- | ------------------------------------------------------------ |
| `groups`    | group names and their display order                           |
| `members`   | the nine seeded members, their unread counts and learned addresses |
| `messages`  | every message, with ingestion provenance where it applies     |
| `app_state` | OAuth tokens, the Gmail history cursor, watch expiry          |

Images live in Vercel Blob, not Postgres.

---

## Deploying to Vercel

### 1. Database and blob store

Attach **Neon Postgres** and a **Blob** store from the project's Storage tab.
That sets `DATABASE_URL` and `BLOB_READ_WRITE_TOKEN`. Then, locally:

```bash
vercel env pull .env.local
```

```bash
npm run db:push
```

### 2. Google Cloud

In a Google Cloud project:

1. Enable the **Gmail API** and the **Cloud Pub/Sub API**.
2. Create a Pub/Sub **topic**, e.g. `gmail-oshi`.
3. On that topic, grant **Pub/Sub Publisher** to
   `gmail-api-push@system.gserviceaccount.com`. Gmail cannot publish without
   this, and the failure is silent.
4. Create a **push subscription** on the topic with endpoint
   `https://<your-app>/api/gmail/push?token=<PUBSUB_PUSH_SECRET>`.
   For OIDC instead, configure a service-account token on the subscription and
   set `PUBSUB_AUDIENCE` (plus optionally `PUBSUB_SERVICE_ACCOUNT`) rather than
   the query token.
5. Configure the **OAuth consent screen** (External is fine; add yourself as a
   test user) with scope `https://www.googleapis.com/auth/gmail.readonly`.
6. Create an **OAuth client ID** of type *Web application* with authorised
   redirect URI `https://<your-app>/api/gmail/callback`.

### 3. Environment

Set on Vercel: `ANTHROPIC_API_KEY`, `APP_PASSWORD`, `GOOGLE_CLIENT_ID`,
`GOOGLE_CLIENT_SECRET`, `GMAIL_PUBSUB_TOPIC`, and one of `PUBSUB_PUSH_SECRET` /
`PUBSUB_AUDIENCE`. `CRON_SECRET` is set by Vercel.

With neither push mechanism configured the webhook refuses every request — it
fails closed rather than accepting anonymous writes.

### 4. Connect

Create the `oshi` label in Gmail and a filter that files idol mail into it. Then
visit `/setup` and press **Connect Gmail**. The checklist there shows which
environment variables are present, whether the watch is active, and when it
expires.

Crons are declared in `vercel.json` — daily watch renewal, 15-minute drain.

---

## Layout

```
src/
  app/
    page.tsx                 view routing (inbox / thread / editor / assign / roster)
    setup/                   Gmail connection + health checklist
    login/                   passphrase gate
    globals.css              Modernist tokens + every component style
    api/
      messages/              read all, create, edit, assign, delete
      members/ groups/       roster writes
      upload/                screenshot → Vercel Blob
      gmail/auth|callback|status|push
      cron/renew-watch|drain
  components/
    InboxView · ThreadView · EditorView · AssignView · RosterView
    TabBar · MessagePhoto
  lib/
    types.ts   domain model          text.ts   sentence splitting, segmentation
    store.ts   client state + cache  cache.ts  IndexedDB snapshot
    seed.ts    design-canvas content auth.ts   session cookie
    server/
      db.ts        Postgres access   gmail.ts    OAuth, watch, ingestion
      translate.ts the Claude call   pipeline.ts translate-and-store
db/schema.sql
scripts/db-push.ts
```

---

## Design system

The Modernist tokens at the top of `globals.css` are copied verbatim from the
design project. Retune the look there, not in components. It is a **zero-radius**
system — nothing rounds a corner — and Archivo at weight 800 carries every
structural label. Noto Sans JP is used only for Japanese text.

On desktop the app renders inside a 390×844 frame with the mock status bar, as
the artboard did. Below 480px the frame drops away and the fake status bar hides
so it does not duplicate the real one.

---

## Notes

- **Gloss matching is literal.** A word only underlines if it appears in the
  Japanese exactly as written, so the translator is asked for inflected surface
  forms. Entries that do not match are dropped server-side.
- **Seed screenshots are placeholders** carrying a sentinel URL; they render the
  design's grey block. Real attachments are stored and displayed.
- **Unread counts are display state** from the design. Opening a thread clears
  the badge; ingestion does not increment it.
- **Offline is read-only.** The cached snapshot renders, but saving, assigning
  and deleting need the server.
