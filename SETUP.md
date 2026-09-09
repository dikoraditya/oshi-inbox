# Oshi Inbox — setup & handoff

Everything needed to pick this up on another machine. Last updated 2026-08-26.

Repo: `git@github.com:dikoraditya/idol-inbox.git`

---

## What this is

A mobile PWA that merges messages from four idol messaging apps (Weverse DM,
755 Talk, niajoy Talk, Mobile Mail) into one inbox, showing Japanese, romaji and
English aligned line for line with tappable word glosses.

Mail filed into a Gmail label is ingested automatically by webhook, translated
by Claude, and waiting for you next time you open the app.

Next.js 16 · TypeScript · Postgres (Neon) · Vercel Blob · Claude API · Vercel.

---

## Get it running locally

```bash
git clone git@github.com:dikoraditya/idol-inbox.git && cd idol-inbox
```

```bash
npm install
```

You need a Postgres URL before anything works. Either pull from Vercel once the
project exists (below), or point `DATABASE_URL` at any Postgres.

```bash
cp .env.example .env.local
```

Fill in `DATABASE_URL` and `ANTHROPIC_API_KEY`, leave `APP_PASSWORD` empty
locally (the gate stays off), then:

```bash
npm run db:push
```

```bash
npm run dev
```

`db:push` is idempotent — safe to re-run. It creates the schema, ensures the
three seed groups exist, and seeds members + messages only if `members` is empty.

---

## Deployment checklist

### 1. Vercel project

- [ ] Import the repo into Vercel
- [ ] Storage tab → attach **Neon Postgres** (sets `DATABASE_URL`)
- [ ] Storage tab → attach **Blob** (sets `BLOB_READ_WRITE_TOKEN`)
- [ ] `vercel env pull .env.local` locally
- [ ] `npm run db:push` against the real database

Without the Blob store the app still works — image attachments are skipped and
message text is ingested normally.

### 2. Google Cloud

In a Google Cloud project:

- [ ] Enable the **Gmail API**
- [ ] Enable the **Cloud Pub/Sub API**
- [ ] Create a Pub/Sub **topic**, e.g. `gmail-oshi`
- [ ] On that topic, grant **Pub/Sub Publisher** to
      `gmail-api-push@system.gserviceaccount.com`
- [ ] Create a **push subscription** on the topic, endpoint:
      `https://<your-app>/api/gmail/push?token=<invent a secret>`
- [ ] **OAuth consent screen**: External, add yourself as a test user,
      scope `https://www.googleapis.com/auth/gmail.readonly`
- [ ] **OAuth client ID**, type *Web application*, authorised redirect URI:
      `https://<your-app>/api/gmail/callback`

> **The publisher grant is the step that bites.** Without it Gmail silently
> never publishes to the topic. No error appears anywhere — ingestion just never
> happens. If mail isn't arriving, check this first.

### 3. Environment variables on Vercel

- [ ] `ANTHROPIC_API_KEY`
- [ ] `APP_PASSWORD` — **always set this in production**
- [ ] `GOOGLE_CLIENT_ID`
- [ ] `GOOGLE_CLIENT_SECRET`
- [ ] `GMAIL_PUBSUB_TOPIC` — `projects/<project>/topics/gmail-oshi`
- [ ] `PUBSUB_PUSH_SECRET` — must match the `?token=` in the subscription
- [ ] `GMAIL_LABEL` — defaults to `oshi`
- [ ] Deploy

### 4. Connect

- [ ] Create the `oshi` label in Gmail
- [ ] Add a Gmail filter that files idol mail into it
- [ ] Visit `/setup` — the checklist shows which variables landed
- [ ] Press **Connect Gmail**, complete consent
- [ ] Confirm the watch shows an expiry countdown

### 5. Smoke test

- [ ] Send yourself a Japanese email into the `oshi` label
- [ ] It appears in the app's **Unassigned** bucket within a minute
- [ ] File it to a member — the thread shows romaji + glosses
- [ ] Send a second mail from that same address — it routes automatically

---

## Environment variable reference

| Variable | Required | What it does |
| --- | --- | --- |
| `DATABASE_URL` | yes | Neon Postgres connection string |
| `ANTHROPIC_API_KEY` | yes | Translation. Server-side only — never prefix `NEXT_PUBLIC_` |
| `APP_PASSWORD` | production | Passphrase gate. Unset = no gate |
| `GOOGLE_CLIENT_ID` / `_SECRET` | for Gmail | OAuth web client |
| `GOOGLE_REDIRECT_URI` | optional | Defaults to `<deployment>/api/gmail/callback` |
| `GMAIL_LABEL` | optional | Defaults to `oshi` |
| `GMAIL_PUBSUB_TOPIC` | for Gmail | `projects/<project>/topics/<topic>` |
| `PUBSUB_PUSH_SECRET` | one of these | Shared secret in the push URL query |
| `PUBSUB_AUDIENCE` | one of these | OIDC audience, if using token auth instead |
| `PUBSUB_SERVICE_ACCOUNT` | optional | Pins OIDC to one service account |
| `BLOB_READ_WRITE_TOKEN` | optional | Image attachments. Set by Vercel |
| `CRON_SECRET` | auto | Set by Vercel; cron routes verify it |

With neither `PUBSUB_PUSH_SECRET` nor `PUBSUB_AUDIENCE` set, the webhook
**refuses every request**. It fails closed rather than accepting anonymous
writes — that is deliberate, not a misconfiguration.

---

## Commands

```bash
npm run dev
```

```bash
npm run build
```

```bash
npm run typecheck
```

```bash
npm run db:push
```

---

## Where things live

```
src/
  app/
    page.tsx                 view routing: inbox / thread / editor / assign / roster
    setup/                   Gmail connection + health checklist
    login/                   passphrase gate
    globals.css              Modernist design tokens + all component styles
    api/
      messages/              read all, create, edit, assign, delete
      members/ groups/       roster writes
      upload/                screenshot -> Vercel Blob
      gmail/                 auth | callback | status | push
      cron/                  renew-watch | drain
  components/
    InboxView ThreadView EditorView AssignView RosterView TabBar MessagePhoto
  lib/
    types.ts    domain model        text.ts   sentence splitting, segmentation
    store.ts    client state        cache.ts  IndexedDB snapshot
    seed.ts     design content      auth.ts   session cookie
    server/
      db.ts        Postgres         gmail.ts     OAuth, watch, ingestion
      translate.ts the Claude call  pipeline.ts  translate-and-store
db/schema.sql
scripts/db-push.ts
```

---

## Design decisions worth remembering

**Sentence alignment is the core mechanic.** Japanese, romaji and English are
split independently and matched by index. This only works if the translation
preserves sentence count — the prompt in `src/lib/server/translate.ts` states
that requirement explicitly and repeats the expected count. If alignment drifts,
that prompt is where to look.

**Gloss matching is literal substring matching.** A word only underlines if it
appears in the Japanese exactly as written, so the translator is asked for
inflected surface forms, not dictionary forms. Non-matching entries are dropped
server-side so the "N words tappable" hint stays truthful.

**Members and groups are data; sources are not.** Both are Postgres tables so the
Roster screen can add to them. Sources are the `SOURCES` constant in `types.ts`
because each is a separate integration, not a label you invent — the API rejects
an unknown source.

**Two silent-failure modes are designed around.** Gmail expires a push watch
after 7 days and reports nothing when it lapses; a daily cron renews it and
`/setup` shows the countdown. Pub/Sub delivers at-least-once and Gmail history
replays, so `gmail_message_id` is unique and inserts are `on conflict do nothing`.

**The webhook acks vs retries deliberately.** An unparseable payload returns 200
so Pub/Sub stops retrying something that can never succeed; a real failure
returns 500 so it does retry.

**Postgres is the source of truth**, IndexedDB holds the last snapshot for
offline reads. Writes go to the server, so they fail while offline rather than
queueing.

---

## Not yet verified

Built and typechecked, but **never actually run**, because the dev machine had no
Postgres, no Docker, and no Google credentials:

- the SQL schema and every query in `src/lib/server/db.ts`
- the whole Gmail flow — OAuth exchange, watch registration, history walk,
  MIME parsing, attachment fetch
- a successful Claude translation round trip

Verified in the browser: the reading view's three-way alignment, word popovers,
clamping, capture, edit, delete, the roster's both forms, the passphrase gate,
and the webhook's accept / reject / ack behaviour.

**Most likely first-contact bug: email body parsing.** Idol mobile mail has
idiosyncratic HTML and footers, and `cleanBody()` in `src/lib/server/gmail.ts`
cuts at the first long horizontal rule — a guess at their shape. Expect to tune
it against a real message.

---

## Open decisions

- **Group deletion** isn't built. The design has no delete, and members reference
  a group by name, so removing one would orphan them. Needs a rule first.
- **Unread counts never increment** on ingestion. Opening a thread clears the
  badge, but arriving mail doesn't raise it. Faithful to the design, arguably
  wrong now that mail actually arrives.
- **Refusal fallback** on the Claude call is omitted — combining it with
  `messages.parse()` isn't documented. The route checks
  `stop_reason === "refusal"` and returns a clean 422 instead.
- **Offline is read-only.** No write queue; saving needs the server.

---

## Troubleshooting

| Symptom | Look at |
| --- | --- |
| No mail ever arrives | Publisher grant on the Pub/Sub topic (step 2) |
| Mail stopped after ~a week | Watch expired — check `/setup`, run the renew cron |
| Everything is "Awaiting translation" | `ANTHROPIC_API_KEY`, then `/api/cron/drain` |
| Webhook returns 401 | `PUBSUB_PUSH_SECRET` mismatch with the subscription URL |
| Alignment is off by a line | Translator merged/split a sentence; see the prompt |
| App shows "Try again" | `DATABASE_URL` unreachable |
| Mail lands but text is mangled | `cleanBody()` in `src/lib/server/gmail.ts` |
