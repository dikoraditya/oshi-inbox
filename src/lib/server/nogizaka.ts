import "server-only";

import type { NormalizedMessage } from "@/lib/ingest";
import type { MediaType } from "@/lib/types";
import { readState, writeState } from "./db";

/**
 * Server-side Nogizaka mobame fetch — headless, no browser. Mirrors cosm.ts so
 * Nogizaka runs on the "Fetch" button like =LOVE/≠ME/≒JOY and NMB b.stage.
 *
 * Auth: the message.nogizaka46.com web app has no email/password grant (sign-in
 * is federated Google OAuth). Instead a rotating server `session` cookie
 * authenticates `POST /v2/update_token` (body `{"refresh_token":null}`), which
 * returns a 1-hour Bearer JWT AND rotates the session via Set-Cookie. So we keep
 * a cookie jar in app_state, refresh the JWT each run, and persist the rotated
 * session for the next run — a durable loop bootstrapped once from a logged-in
 * browser (NOGIZAKA_COOKIE).
 *
 * Caveat: the app and a live logged-in browser share the same rotating session —
 * whichever calls update_token last invalidates the other's stored session. Run
 * this when you're not actively using the mobame web app; if the session dies,
 * re-bootstrap NOGIZAKA_COOKIE from the browser.
 */

const API_BASE = process.env.NOGIZAKA_API_BASE?.trim() || "https://api.message.nogizaka46.com";
const APP_ID = process.env.NOGIZAKA_APP_ID?.trim() || "jp.co.sonymusic.communication.nogizaka 2.5";
const ORGANIZATION_ID = process.env.NOGIZAKA_ORG_ID?.trim() || "1";

/** app_state key holding the current cookie jar (rotates each refresh). */
const COOKIE_KEY = "nogizaka:cookie";
/** app_state key holding per-group watermarks (newest updated_at ISO seen). */
const WATERMARK_KEY = "nogizaka:watermark";

/** How far back the first pull of a group walks when it has no watermark yet. */
const DEFAULT_LOOKBACK_MS = 14 * 24 * 60 * 60 * 1000;
const MAX_PAGES = 40;

const HEADERS: Record<string, string> = {
  "content-type": "application/json",
  accept: "application/json",
  "x-talk-app-id": APP_ID,
  "x-talk-app-platform": "web",
  "accept-language": "ja-JP",
  origin: "https://message.nogizaka46.com",
  referer: "https://message.nogizaka46.com/",
};

/** True when a bootstrap cookie seed is present (env). The live value lives in app_state. */
export function isConfigured(): boolean {
  return Boolean(process.env.NOGIZAKA_COOKIE?.trim());
}

/** Current cookie jar: the app_state copy (rotated) wins over the env seed. */
async function currentJar(): Promise<string | null> {
  const stored = await readState<string>(COOKIE_KEY);
  return stored ?? process.env.NOGIZAKA_COOKIE?.trim() ?? null;
}

/** Replace the `session=` entries in the jar with the freshly rotated ones. */
function mergeSessions(jar: string, setCookies: string[]): string {
  const rotated = setCookies
    .map((c) => /^session=([^;]+)/.exec(c)?.[1])
    .filter((v): v is string => Boolean(v));
  if (!rotated.length) return jar;
  const kept = jar
    .split(";")
    .map((s) => s.trim())
    .filter((s) => s && !s.startsWith("session="));
  return [...rotated.map((v) => `session=${v}`), ...kept].join("; ");
}

/**
 * Refresh the access token. Sends the stored jar, persists the rotated session,
 * returns a 1-hour Bearer JWT. Throws (with a re-bootstrap hint) on a dead session.
 */
async function updateToken(): Promise<string> {
  const jar = await currentJar();
  if (!jar) throw new Error("Nogizaka not configured — set NOGIZAKA_COOKIE (bootstrap from a logged-in session).");

  const res = await fetch(`${API_BASE}/v2/update_token`, {
    method: "POST",
    headers: { ...HEADERS, cookie: jar },
    body: JSON.stringify({ refresh_token: null }),
  });
  if (!res.ok) {
    throw new Error(`nogizaka update_token ${res.status} — session expired; re-bootstrap NOGIZAKA_COOKIE from a logged-in browser.`);
  }
  const setCookies = typeof res.headers.getSetCookie === "function" ? res.headers.getSetCookie() : [];
  const body = (await res.json()) as { access_token?: string };
  if (!body.access_token) throw new Error("nogizaka update_token returned no access_token");

  const merged = mergeSessions(jar, setCookies);
  if (merged !== jar) await writeState(COOKIE_KEY, merged);
  return body.access_token;
}

async function getJson<T>(url: string, jwt: string): Promise<T> {
  const res = await fetch(url, { headers: { ...HEADERS, authorization: `Bearer ${jwt}` } });
  if (!res.ok) throw new Error(`${res.status} ${url}`);
  return (await res.json()) as T;
}

interface GroupRow {
  id: number;
  name?: string;
  member_name?: string;
  thumbnail?: string;
}

async function fetchGroups(jwt: string): Promise<{ ids: number[]; names: Record<number, string> }> {
  const rows = await getJson<GroupRow[]>(`${API_BASE}/v2/groups?organization_id=${ORGANIZATION_ID}`, jwt);
  const ids: number[] = [];
  const names: Record<number, string> = {};
  for (const g of rows) {
    ids.push(g.id);
    names[g.id] = g.member_name ?? g.name ?? "";
  }
  return { ids, names };
}

interface NogizakaMessage {
  id: number;
  group_id: number;
  type: "text" | "picture" | "video" | "voice" | "link";
  text?: string | null;
  published_at: string;
  updated_at: string;
  file?: string | null;
  thumbnail?: string | null;
}
interface NogizakaTimeline {
  messages: NogizakaMessage[];
}

function timelineUrl(groupId: number, updatedFrom: string, count = 200): string {
  const q = new URLSearchParams({ updated_from: updatedFrom, count: String(count), order: "asc" });
  return `${API_BASE}/v2/groups/${groupId}/timeline?${q.toString()}`;
}

/** Media URL + render type per message type (file is a signed CloudFront URL). */
function mediaFor(m: NogizakaMessage): { url: string | null; mediaType: MediaType } {
  if (m.type === "picture") return { url: m.file ?? m.thumbnail ?? null, mediaType: "image" };
  if (m.type === "video") return { url: m.file ?? m.thumbnail ?? null, mediaType: "video" };
  if (m.type === "voice") return { url: m.file ?? null, mediaType: "audio" };
  return { url: null, mediaType: "image" };
}

function displayTime(epochMs: number, now = Date.now()): string {
  const d = new Date(epochMs);
  const sameDay = new Date(now).toDateString() === d.toDateString();
  if (sameDay) return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
  return `${d.toLocaleString("en-US", { month: "short" })} ${d.getDate()}`;
}

function mapTimeline(timeline: NogizakaTimeline, names: Record<number, string>): NormalizedMessage[] {
  const now = Date.now();
  return timeline.messages.map((m) => {
    const createdAt = Date.parse(m.published_at);
    const media = mediaFor(m);
    return {
      ingestSource: "nogizaka",
      externalId: String(m.id),
      source: "Nogizaka Mail",
      attributionKey: `nogizaka:${m.group_id}`,
      senderName: names[m.group_id] ?? "",
      jp: m.text ?? "",
      time: displayTime(createdAt, now),
      createdAt,
      imageUrl: media.url,
      mediaType: media.mediaType,
    };
  });
}

/**
 * Page every subscribed group from its watermark (groups you aren't subscribed
 * to 403/404 and are skipped), normalise, and advance each watermark. The caller
 * ingests; the server dedupes on (ingest_source, external_id).
 */
export async function collectNogizaka(): Promise<NormalizedMessage[]> {
  const jwt = await updateToken();
  const { ids, names } = await fetchGroups(jwt);

  const watermark = (await readState<Record<string, string>>(WATERMARK_KEY)) ?? {};
  const defaultSince = new Date(Date.now() - DEFAULT_LOOKBACK_MS).toISOString();
  const out: NormalizedMessage[] = [];

  for (const groupId of ids) {
    const key = `nogizaka:${groupId}`;
    let since = watermark[key] ?? defaultSince;
    try {
      for (let page = 0; page < MAX_PAGES; page += 1) {
        const timeline = await getJson<NogizakaTimeline>(timelineUrl(groupId, since), jwt);
        const msgs = timeline.messages ?? [];
        if (!msgs.length) break;
        out.push(...mapTimeline(timeline, names));
        let max = since;
        for (const m of msgs) if (m.updated_at > max) max = m.updated_at;
        if (max === since) break;
        since = max;
        watermark[key] = since;
        if (msgs.length < 200) break;
      }
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      // 403/404 = not subscribed to this group; skip quietly.
      if (!/\b40[34]\b/.test(msg)) console.error(`[nogizaka:${groupId}] timeline failed:`, msg);
    }
  }

  await writeState(WATERMARK_KEY, watermark);
  return out;
}
