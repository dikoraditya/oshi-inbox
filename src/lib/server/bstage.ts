import "server-only";

import type { NormalizedMessage } from "@/lib/ingest";
import type { MediaType, Source } from "@/lib/types";

/**
 * Server-side NMB48 b.stage (bemyfriends) fetch — the "POP" DM feature.
 *
 * b.stage is a pure REST API: email/password login returns a JWT, and the
 * member list (`circles`) is a plain Bearer GET. Like COSM it needs no browser.
 *
 * LIMITATION (v1): b.stage only exposes each member's *latest* POP message to
 * web/API callers (`circle.latestOfflineRoomMessage`); the full message history
 * is served only to the native app. So this collects the newest message per
 * subscribed member on each run. Poll regularly to catch each new one; a member
 * posting twice between polls will have the older one missed. Full backfill needs
 * the native `moment` endpoint (capture via mitmproxy) — a future v2.
 *
 * There is no message id in the payload, so the idempotency key is
 * `<circleId>:<publishedAt>` — a member won't post two messages at the same ms.
 */

const STAGE_ID = process.env.BSTAGE_STAGE_ID || "nmb48-global";
const HOST = `https://${STAGE_ID}.bstage.in`;
const SOURCE: Source = "NMB48 Talk";

export function isConfigured(): boolean {
  return Boolean(process.env.BSTAGE_EMAIL && process.env.BSTAGE_PASSWORD);
}

async function login(): Promise<string> {
  const res = await fetch(`${HOST}/svc/account/api/v1/auth/token?stageId=${STAGE_ID}`, {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json" },
    body: JSON.stringify({
      email: process.env.BSTAGE_EMAIL,
      password: process.env.BSTAGE_PASSWORD,
    }),
  });
  if (!res.ok) throw new Error(`bstage login ${res.status}`);
  const body = (await res.json()) as { accessToken?: string };
  if (!body.accessToken) throw new Error("bstage login returned no accessToken");
  return body.accessToken;
}

interface BstageImage {
  path?: string;
  width?: number;
  height?: number;
}

interface OfflineRoomMessage {
  writtenAt?: string;
  publishedAt?: string;
  message?: string;
  image?: BstageImage;
  video?: BstageImage;
  type?: string;
}

interface Circle {
  id: string;
  creator?: { id?: string; nickname?: string };
  isSubscribe?: boolean;
  latestOfflineRoomMessage?: OfflineRoomMessage;
}

async function fetchCircles(token: string): Promise<Circle[]> {
  const res = await fetch(`${HOST}/svc/live-streaming/api/v2/circles`, {
    headers: { authorization: `Bearer ${token}`, accept: "application/json" },
  });
  if (!res.ok) throw new Error(`bstage circles ${res.status}`);
  const body = (await res.json()) as { circles?: Circle[] };
  return body.circles ?? [];
}

/** Map a circle's latest POP message to normalised form, or null to skip. */
function mapLatest(circle: Circle): NormalizedMessage | null {
  const m = circle.latestOfflineRoomMessage;
  if (!m || !m.publishedAt) return null;

  const isVideo = m.type === "PRIVATE_MESSAGE_VIDEO" || Boolean(m.video?.path);
  const isImage = m.type === "PRIVATE_MESSAGE_IMAGE" || Boolean(m.image?.path);
  const url = isVideo ? (m.video?.path ?? null) : isImage ? (m.image?.path ?? null) : null;
  const text = m.message ?? "";

  // Skip messages with neither text nor fetchable media (e.g. bare emoticons).
  if (!text && !url) return null;

  const createdAt = Date.parse(m.publishedAt) || Date.now();
  const d = new Date(createdAt);
  const time = `${d.toLocaleString("en-US", { month: "short" })} ${d.getDate()}`;
  return {
    ingestSource: "bstage" as const,
    externalId: `${circle.id}:${m.publishedAt}`,
    source: SOURCE,
    attributionKey: `bstage:${circle.id}`,
    senderName: circle.creator?.nickname ?? "",
    jp: text,
    time,
    createdAt,
    imageUrl: url && /^https?:\/\//.test(url) ? url : null,
    mediaType: (isVideo ? "video" : "image") as MediaType,
  };
}

/**
 * Fetch the latest POP message for the given circle ids (or every subscribed
 * member when none are given). Logs in fresh each call.
 */
export async function collectCircles(circleIds?: string[]): Promise<NormalizedMessage[]> {
  if (!isConfigured()) throw new Error("BSTAGE_EMAIL / BSTAGE_PASSWORD are not set.");
  const token = await login();
  const circles = await fetchCircles(token);
  const want = circleIds && circleIds.length ? new Set(circleIds) : null;

  const out: NormalizedMessage[] = [];
  for (const circle of circles) {
    if (want ? !want.has(circle.id) : !circle.isSubscribe) continue;
    const mapped = mapLatest(circle);
    if (mapped) out.push(mapped);
  }
  return out;
}

/** Circle ids for every subscribed member — used to seed the roster + fetch-all. */
export async function subscribedCircles(): Promise<Array<{ id: string; nickname: string }>> {
  if (!isConfigured()) return [];
  const token = await login();
  const circles = await fetchCircles(token);
  return circles
    .filter((c) => c.isSubscribe)
    .map((c) => ({ id: c.id, nickname: c.creator?.nickname ?? c.id }));
}
