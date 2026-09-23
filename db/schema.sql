-- Oshi Inbox — Postgres schema.
--
-- Applied with `npm run db:push`, which is idempotent: every statement is
-- IF NOT EXISTS, so re-running against a populated database is safe.

-- Groups are data, not a constant: the Roster screen can add one.
-- Members reference a group by name, which is what the whole UI displays.
create table if not exists groups (
  name       text primary key,
  sort_order integer not null default 0
);

create table if not exists members (
  id           text primary key,
  name         text    not null,
  "group"      text    not null,
  source       text    not null,
  unread       integer not null default 0,
  time         text    not null default '',
  sort_order   integer not null default 0,
  -- Sender addresses that attribute to this member. Learned when you assign an
  -- unassigned mail, so the next one from that address routes automatically.
  email_addresses text[] not null default '{}'
);

create table if not exists messages (
  id          text primary key,
  -- Nullable: ingested mail from an unrecognised sender waits here until you
  -- assign it, rather than being guessed at or dropped.
  member_id   text references members(id) on delete cascade,
  jp          text    not null default '',
  romaji      text    not null default '',
  en          text    not null default '',
  words       jsonb   not null default '[]'::jsonb,
  time        text    not null default '',
  source      text    not null,
  -- Vercel Blob URL. Postgres is the wrong place for image bytes.
  image_url   text,
  long        boolean not null default false,
  status      text    not null default 'pending',
  error       text,
  created_at  bigint  not null,

  -- Ingestion provenance. The unique constraint is what makes the webhook
  -- idempotent: Pub/Sub delivers at-least-once, so the same mail will arrive
  -- more than once and must not produce duplicate rows.
  gmail_message_id text unique,
  from_email       text,
  from_name        text
);

create index if not exists messages_member_idx  on messages (member_id, created_at);
create index if not exists messages_status_idx  on messages (status);
create index if not exists messages_pending_idx on messages (status) where status = 'pending';

-- Generic ingestion provenance for the API-based sources (Weverse, Nogizaka,
-- niajoy) that the collector pulls, as opposed to Gmail's push path above.
--
-- `ingest_source` is the adapter key ('weverse' | 'nogizaka' | 'niajoy'), not
-- the display Source; `external_id` is that service's own native message id.
-- Together they are unique, which is what makes the collector idempotent: it
-- re-reads overlapping pages every run and must never double-insert. Gmail keeps
-- its own gmail_message_id constraint above and is untouched.
alter table messages add column if not exists ingest_source text;
alter table messages add column if not exists external_id   text;

-- Whether image_url points at an image or a video. COSM LINK messages can carry
-- either; Gmail/hand-captured rows are always images, so 'image' is the default.
alter table messages add column if not exists media_type text not null default 'image';

-- A unique index (not a table constraint) so this stays a single IF NOT EXISTS
-- statement — db-push splits the file on line-ending semicolons, which a
-- do-block would break. NULLs compare distinct, so Gmail rows (both columns
-- null) never collide here; collector rows always set both.
create unique index if not exists messages_ingest_external_idx
  on messages (ingest_source, external_id);

-- Attribution for non-email sources. Mirrors members.email_addresses, but the
-- keys are source-scoped ('nogizaka:68', 'weverse:WROTC91', 'niajoy:46') so a
-- room/group id learned once routes every later message from it automatically.
alter table members add column if not exists attribution_keys text[] not null default '{}';

-- Editable profile fields. avatar_url is auto-populated from the source where
-- available (Weverse dmOfficialImageUrl, Nogizaka group thumbnail) and can be
-- overridden from the member's Edit Profile screen; blog_url is user-set, for
-- future blog capture (Nogizaka/≒JOY blogs). Email routing already lives in
-- members.email_addresses above.
alter table members add column if not exists avatar_url text;
alter table members add column if not exists blog_url   text;

-- Single-row-per-key store for OAuth tokens, the Gmail history cursor, the
-- watch expiry, and reading settings.
create table if not exists app_state (
  key        text primary key,
  value      jsonb       not null,
  updated_at timestamptz not null default now()
);

-- Learning layer: known-word set + a small SM-2 spaced-repetition deck.
create table if not exists learn_words (
  word          text primary key,
  reading       text not null default '',
  gloss         text not null default '',
  status        text not null default 'learning',
  ease          real not null default 2.5,
  interval_days integer not null default 0,
  due           bigint not null default 0,
  reps          integer not null default 0,
  updated_at    timestamptz not null default now()
);
