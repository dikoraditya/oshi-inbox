import "server-only";

import { createSql } from "./sql";
import { randomUUID } from "node:crypto";

import type { Gloss, MediaType, Member, Message, Source, TranslationStatus } from "@/lib/types";

/**
 * Server-side data access.
 *
 * The driver is chosen in ./sql — Neon's HTTP driver in the cloud (Vercel
 * functions are short-lived and would otherwise exhaust a TCP pool), or a
 * node-postgres adapter with the identical surface for a local Postgres.
 */

function client() {
  return createSql();
}

/* ── row mapping ─────────────────────────────────────────────────────────── */

interface MemberRow {
  id: string;
  name: string;
  group: string;
  source: string;
  unread: number;
  time: string;
  email_addresses: string[];
  attribution_keys: string[];
  avatar_url: string | null;
  blog_url: string | null;
}

interface MessageRow {
  id: string;
  member_id: string | null;
  jp: string;
  romaji: string;
  en: string;
  words: Gloss[];
  time: string;
  source: string;
  image_url: string | null;
  media_type: string;
  long: boolean;
  status: string;
  error: string | null;
  created_at: string | number;
  gmail_message_id: string | null;
  from_email: string | null;
  from_name: string | null;
}

function toMember(row: MemberRow): Member {
  return {
    id: row.id,
    name: row.name,
    group: row.group as Member["group"],
    source: row.source as Source,
    unread: row.unread,
    time: row.time,
    emailAddresses: row.email_addresses ?? [],
    attributionKeys: row.attribution_keys ?? [],
    avatarUrl: row.avatar_url ?? null,
    blogUrl: row.blog_url ?? null,
  };
}

function toMessage(row: MessageRow): Message {
  return {
    id: row.id,
    memberId: row.member_id,
    jp: row.jp,
    romaji: row.romaji,
    en: row.en,
    // jsonb comes back parsed, but a text column would not — be tolerant.
    words: typeof row.words === "string" ? JSON.parse(row.words) : (row.words ?? []),
    time: row.time,
    source: row.source as Source,
    imageUrl: row.image_url,
    mediaType: (row.media_type as MediaType) ?? "image",
    long: row.long,
    status: row.status as TranslationStatus,
    error: row.error,
    // bigint arrives as a string from the driver; the app treats it as a number.
    createdAt: Number(row.created_at),
    gmailMessageId: row.gmail_message_id,
    fromEmail: row.from_email,
    fromName: row.from_name,
  };
}

/* ── members ─────────────────────────────────────────────────────────────── */

export async function listMembers(): Promise<Member[]> {
  const sql = client();
  const rows = (await sql`
    select id, name, "group", source, unread, time, email_addresses, attribution_keys, avatar_url, blog_url
    from members order by sort_order asc
  `) as MemberRow[];
  return rows.map(toMember);
}

/** Create a member from the Roster screen. */
export async function insertMember(member: {
  id: string;
  name: string;
  group: string;
  source: Source;
  /** Source-scoped routing keys to pre-map this member (e.g. ["cosm:46"]). */
  attributionKeys?: string[];
}): Promise<Member> {
  const sql = client();
  const rows = (await sql`
    insert into members (id, name, "group", source, unread, time, sort_order, attribution_keys)
    values (
      ${member.id}, ${member.name}, ${member.group}, ${member.source}, 0, 'new',
      coalesce((select max(sort_order) + 1 from members), 0), ${member.attributionKeys ?? []}
    )
    returning id, name, "group", source, unread, time, email_addresses, attribution_keys, avatar_url, blog_url
  `) as MemberRow[];
  return toMember(rows[0]);
}

/**
 * Create/update members a collector discovered (e.g. Nogizaka groups, whose API
 * returns member names), each carrying its source-scoped attribution key so
 * ingested messages route straight to them instead of landing in Unassigned.
 *
 * Idempotent: on an existing id it refreshes the name and ensures the key is
 * present, but never clobbers keys a user already learned by hand.
 */
export async function upsertRosterMembers(
  members: Array<{
    id: string;
    name: string;
    group: string;
    source: string;
    key: string;
    avatarUrl?: string | null;
  }>,
): Promise<number> {
  if (!members.length) return 0;
  const sql = client();

  // Ensure each referenced group exists, so the inbox can bucket these members
  // (Weverse artists, unlike Nogizaka, have no pre-seeded group).
  for (const group of [...new Set(members.map((m) => m.group))]) {
    await sql`
      insert into groups (name, sort_order)
      values (${group}, coalesce((select max(sort_order) + 1 from groups), 0))
      on conflict (name) do nothing
    `;
  }

  let count = 0;
  for (const m of members) {
    await sql`
      insert into members (id, name, "group", source, unread, time, sort_order, attribution_keys, avatar_url)
      values (
        ${m.id}, ${m.name}, ${m.group}, ${m.source}, 0, 'new',
        coalesce((select max(sort_order) + 1 from members), 0), ${[m.key]}, ${m.avatarUrl ?? null}
      )
      on conflict (id) do update set
        name = excluded.name,
        -- Fill the avatar from the source, but never clobber one set by hand.
        avatar_url = coalesce(members.avatar_url, excluded.avatar_url),
        attribution_keys = case
          when ${m.key} = any(members.attribution_keys) then members.attribution_keys
          else array_append(members.attribution_keys, ${m.key})
        end
    `;
    count += 1;
  }
  return count;
}

/* ── groups ──────────────────────────────────────────────────────────────── */

export async function listGroups(): Promise<string[]> {
  const sql = client();
  const rows = (await sql`
    select name from groups order by sort_order asc, name asc
  `) as Array<{ name: string }>;
  return rows.map((row) => row.name);
}

/** Add a group. Returns false when that name already exists. */
export async function insertGroup(name: string): Promise<boolean> {
  const sql = client();
  const rows = (await sql`
    insert into groups (name, sort_order)
    values (${name}, coalesce((select max(sort_order) + 1 from groups), 0))
    on conflict (name) do nothing
    returning name
  `) as Array<{ name: string }>;
  return rows.length > 0;
}

export async function clearUnread(memberId: string): Promise<void> {
  const sql = client();
  await sql`update members set unread = 0 where id = ${memberId}`;
}

/** Remember that this address belongs to this member, for future ingestion. */
export async function learnSenderAddress(memberId: string, email: string): Promise<void> {
  const sql = client();
  const address = email.trim().toLowerCase();
  if (!address) return;
  await sql`
    update members
    set email_addresses = array_append(email_addresses, ${address})
    where id = ${memberId} and not (${address} = any(email_addresses))
  `;
}

/** Find the member an incoming sender address maps to, if any. */
export async function memberForSender(email: string): Promise<Member | null> {
  const sql = client();
  const address = email.trim().toLowerCase();
  if (!address) return null;
  const rows = (await sql`
    select id, name, "group", source, unread, time, email_addresses, attribution_keys, avatar_url, blog_url
    from members where ${address} = any(email_addresses) limit 1
  `) as MemberRow[];
  return rows[0] ? toMember(rows[0]) : null;
}

/**
 * Map a sender address to a member, creating one when it is genuinely new.
 *
 * The label-free listen path: hand the app an email (optionally a name/group)
 * and it either finds the member that already owns that address, matches an
 * existing member **of the same source** by name and learns the address for
 * them, or creates a fresh member and attaches it. The same-source rule keeps
 * methods separate: a Mobile Mail address for someone who also has a Weverse
 * member gets its own Mobile Mail member instead of merging into the Weverse
 * one. Idempotent — the same email always resolves to the same member.
 */
export async function resolveOrCreateMemberByEmail(input: {
  email: string;
  name?: string;
  group?: string;
  source?: Source;
}): Promise<{ member: Member; created: boolean }> {
  const email = input.email.trim().toLowerCase();
  if (!email) throw new Error("An email address is required.");

  // The method this registration is for. Matching and creation are both scoped
  // to it, so an idol reachable on several apps keeps one member per method.
  const source: Source = input.source ?? "Mobile Mail";

  // 1. Already mapped to someone.
  const owner = await memberForSender(email);
  if (owner) return { member: owner, created: false };

  const wantName = input.name?.trim();

  // 2. Matches an existing roster member by name → learn the address for them.
  if (wantName) {
    const members = await listMembers();
    const match = members.find(
      (m) => m.name.toLowerCase() === wantName.toLowerCase() && m.source === source,
    );
    if (match) {
      await learnSenderAddress(match.id, email);
      return {
        member: { ...match, emailAddresses: [...match.emailAddresses, email] },
        created: false,
      };
    }
  }

  // 3. Genuinely new → create a member and attach the address.
  const groups = await listGroups();
  const member = await insertMember({
    id: `mbr-${randomUUID()}`,
    name: wantName || email.split("@")[0],
    group: input.group?.trim() || groups[0] || "Unsorted",
    source,
  });
  await learnSenderAddress(member.id, email);
  return { member: { ...member, emailAddresses: [email] }, created: true };
}

/** Remember that this source-scoped key belongs to this member. */
export async function learnAttributionKey(memberId: string, key: string): Promise<void> {
  const sql = client();
  const value = key.trim();
  if (!value) return;
  await sql`
    update members
    set attribution_keys = array_append(attribution_keys, ${value})
    where id = ${memberId} and not (${value} = any(attribution_keys))
  `;
}

/** Find the member a source-scoped ingest key maps to, if any. */
export async function memberForKey(key: string): Promise<Member | null> {
  const sql = client();
  const value = key.trim();
  if (!value) return null;
  const rows = (await sql`
    select id, name, "group", source, unread, time, email_addresses, attribution_keys, avatar_url, blog_url
    from members where ${value} = any(attribution_keys) limit 1
  `) as MemberRow[];
  return rows[0] ? toMember(rows[0]) : null;
}

/** Update the editable profile fields from the Edit Profile screen. Only the
 * fields present in the patch are written; a null clears that field. */
export async function updateMember(
  id: string,
  patch: { name?: string; avatarUrl?: string | null; blogUrl?: string | null },
): Promise<Member | null> {
  const sql = client();
  const rows = (await sql`
    update members set
      name       = coalesce(${patch.name ?? null}, name),
      avatar_url = case when ${patch.avatarUrl === undefined} then avatar_url else ${patch.avatarUrl ?? null} end,
      blog_url   = case when ${patch.blogUrl === undefined} then blog_url else ${patch.blogUrl ?? null} end
    where id = ${id}
    returning id, name, "group", source, unread, time, email_addresses, attribution_keys, avatar_url, blog_url
  `) as MemberRow[];
  return rows[0] ? toMember(rows[0]) : null;
}

/* ── messages ────────────────────────────────────────────────────────────── */

const MESSAGE_COLUMNS = `
  id, member_id, jp, romaji, en, words, time, source, image_url, media_type,
  long, status, error, created_at, gmail_message_id, from_email, from_name
`;

export async function listMessages(sinceMs?: number): Promise<Message[]> {
  const sql = client();
  const rows = (
    sinceMs
      ? await sql.query(
          `select ${MESSAGE_COLUMNS} from messages where created_at >= $1 order by created_at asc`,
          [sinceMs],
        )
      : await sql.query(`select ${MESSAGE_COLUMNS} from messages order by created_at asc`)
  ) as MessageRow[];
  return rows.map(toMessage);
}

export async function getMessage(id: string): Promise<Message | null> {
  const sql = client();
  const rows = (await sql.query(`select ${MESSAGE_COLUMNS} from messages where id = $1`, [
    id,
  ])) as MessageRow[];
  return rows[0] ? toMessage(rows[0]) : null;
}

/**
 * Existence + media presence for an ingested row. Lets the collector path both
 * dedupe cheaply and repair a row whose media copy previously failed (stored
 * with a null image_url) once the source offers the file again.
 */
export async function messageMediaState(
  id: string,
): Promise<{ exists: boolean; imageUrl: string | null }> {
  const sql = client();
  const rows = (await sql`select image_url from messages where id = ${id} limit 1`) as Array<{
    image_url: string | null;
  }>;
  return rows[0] ? { exists: true, imageUrl: rows[0].image_url } : { exists: false, imageUrl: null };
}

/** Attach media to an existing row, leaving its text and translation untouched. */
export async function updateMessageMedia(
  id: string,
  imageUrl: string,
  mediaType: MediaType,
): Promise<void> {
  const sql = client();
  await sql`update messages set image_url = ${imageUrl}, media_type = ${mediaType} where id = ${id}`;
}

/** Insert or overwrite a message. Used by the capture form and by edits. */
export async function upsertMessage(message: Message): Promise<Message> {
  const sql = client();
  const rows = (await sql.query(
    `insert into messages (id, member_id, jp, romaji, en, words, time, source,
                           image_url, media_type, long, status, error, created_at,
                           gmail_message_id, from_email, from_name)
     values ($1,$2,$3,$4,$5,$6::jsonb,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)
     on conflict (id) do update set
       member_id = excluded.member_id,
       jp        = excluded.jp,
       romaji    = excluded.romaji,
       en        = excluded.en,
       words     = excluded.words,
       time      = excluded.time,
       source    = excluded.source,
       image_url = excluded.image_url,
       media_type = excluded.media_type,
       long      = excluded.long,
       status    = excluded.status,
       error     = excluded.error
     returning ${MESSAGE_COLUMNS}`,
    [
      message.id,
      message.memberId,
      message.jp,
      message.romaji,
      message.en,
      JSON.stringify(message.words ?? []),
      message.time,
      message.source,
      message.imageUrl,
      message.mediaType ?? "image",
      message.long,
      message.status,
      message.error ?? null,
      message.createdAt,
      message.gmailMessageId ?? null,
      message.fromEmail ?? null,
      message.fromName ?? null,
    ],
  )) as MessageRow[];
  return toMessage(rows[0]);
}

/**
 * Insert an ingested mail, ignoring it if that Gmail id is already stored.
 *
 * Pub/Sub delivers at-least-once and Gmail history can replay, so this will be
 * called repeatedly for the same mail. Returns null when nothing was inserted.
 */
export async function insertIngested(message: Message): Promise<Message | null> {
  const sql = client();
  const rows = (await sql.query(
    `insert into messages (id, member_id, jp, romaji, en, words, time, source,
                           image_url, long, status, created_at,
                           gmail_message_id, from_email, from_name)
     values ($1,$2,$3,'','','[]'::jsonb,$4,$5,$6,$7,'pending',$8,$9,$10,$11)
     on conflict (gmail_message_id) do nothing
     returning ${MESSAGE_COLUMNS}`,
    [
      message.id,
      message.memberId,
      message.jp,
      message.time,
      message.source,
      message.imageUrl,
      message.long,
      message.createdAt,
      message.gmailMessageId,
      message.fromEmail,
      message.fromName,
    ],
  )) as MessageRow[];
  return rows[0] ? toMessage(rows[0]) : null;
}

/**
 * Insert a collector-ingested message, ignoring it if that (ingest_source,
 * external_id) pair is already stored.
 *
 * The collector re-reads overlapping pages every run, so this is called
 * repeatedly for the same message; the unique index makes that a no-op. Returns
 * null when nothing was inserted. Sender name rides in from_name so an
 * unassigned message still shows who it is from.
 */
export async function insertIngestedExternal(row: {
  id: string;
  ingestSource: string;
  externalId: string;
  memberId: string | null;
  jp: string;
  time: string;
  source: Source;
  imageUrl: string | null;
  mediaType?: MediaType;
  long: boolean;
  createdAt: number;
  senderName: string;
}): Promise<Message | null> {
  const sql = client();
  const rows = (await sql.query(
    `insert into messages (id, member_id, jp, romaji, en, words, time, source,
                           image_url, media_type, long, status, created_at,
                           ingest_source, external_id, from_name)
     values ($1,$2,$3,'','','[]'::jsonb,$4,$5,$6,$7,$8,'pending',$9,$10,$11,$12)
     on conflict (ingest_source, external_id) do nothing
     returning ${MESSAGE_COLUMNS}`,
    [
      row.id,
      row.memberId,
      row.jp,
      row.time,
      row.source,
      row.imageUrl,
      row.mediaType ?? "image",
      row.long,
      row.createdAt,
      row.ingestSource,
      row.externalId,
      row.senderName || null,
    ],
  )) as MessageRow[];
  return rows[0] ? toMessage(rows[0]) : null;
}

export async function deleteMessage(id: string): Promise<void> {
  const sql = client();
  await sql`delete from messages where id = ${id}`;
}

/** Attribute an unassigned ingested mail to a member. */
export async function assignMessage(id: string, memberId: string): Promise<Message | null> {
  const sql = client();
  const rows = (await sql.query(
    `update messages set member_id = $2 where id = $1 returning ${MESSAGE_COLUMNS}`,
    [id, memberId],
  )) as MessageRow[];
  return rows[0] ? toMessage(rows[0]) : null;
}

export async function saveTranslation(
  id: string,
  result: { romaji: string; en: string; words: Gloss[] },
): Promise<void> {
  const sql = client();
  await sql`
    update messages
    set romaji = ${result.romaji}, en = ${result.en},
        words = ${JSON.stringify(result.words)}::jsonb,
        status = 'done', error = null
    where id = ${id}
  `;
}

export async function markTranslationFailed(id: string, error: string): Promise<void> {
  const sql = client();
  await sql`update messages set status = 'failed', error = ${error} where id = ${id}`;
}

export async function markTranslationPending(id: string): Promise<void> {
  const sql = client();
  await sql`update messages set status = 'pending', error = null where id = ${id}`;
}

/** Pending translations, newest first — so a limited credit budget translates
 * the latest messages before the older backlog. Drained by cron as a safety net. */
export async function listPending(limit = 10): Promise<Message[]> {
  const sql = client();
  const rows = (await sql.query(
    `select ${MESSAGE_COLUMNS} from messages
     where status = 'pending' and jp <> '' order by created_at desc limit $1`,
    [limit],
  )) as MessageRow[];
  return rows.map(toMessage);
}

/** Pending translations for one member, newest first — the translate-on-read set. */
export async function listPendingForMember(memberId: string, limit = 50): Promise<Message[]> {
  const sql = client();
  const rows = (await sql.query(
    `select ${MESSAGE_COLUMNS} from messages
     where member_id = $1 and status = 'pending' and jp <> '' order by created_at desc limit $2`,
    [memberId, limit],
  )) as MessageRow[];
  return rows.map(toMessage);
}

/* ── app_state ───────────────────────────────────────────────────────────── */

export async function readState<T>(key: string): Promise<T | null> {
  const sql = client();
  const rows = (await sql`select value from app_state where key = ${key}`) as Array<{ value: T }>;
  return rows[0]?.value ?? null;
}

export async function writeState<T>(key: string, value: T): Promise<void> {
  const sql = client();
  await sql`
    insert into app_state (key, value, updated_at)
    values (${key}, ${JSON.stringify(value)}::jsonb, now())
    on conflict (key) do update set value = excluded.value, updated_at = now()
  `;
}
