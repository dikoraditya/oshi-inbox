import "server-only";

import type { NormalizedMessage } from "@/lib/ingest";
import type { MediaType, Source } from "@/lib/types";
import { memberForKey, readState, updateMember, writeState } from "./db";
import { storeMedia } from "./media";

/**
 * Server-side COSM LINK fetch, so the app can pull =LOVE/≠ME/≒JOY on demand
 * (the "Fetch" buttons) without the local collector. COSM is a plain REST API —
 * username/password login, media URLs inline — so unlike Weverse/Nogizaka (which
 * need a real browser) it runs fine inside a serverless function.
 *
 * This mirrors collector/src/adapters/cosm.ts. The collector remains the only
 * way to pull the browser-driven sources; keep the room→member tables in sync.
 */

// COSM migrated auth to a Connect-RPC endpoint on the `api.backend.` host; the
// old `api.` REST `/login` now edge-403s. Login is protobuf + a verification key.
const AUTH_BASE = "https://api.backend.entertainment-platform-auth.cosm.jp";
const API_BASE = "https://v3.api.equal-love.link.cosm.jp";

/** app_state key holding the per-room watermark (newest message id seen). */
const WATERMARK_KEY = "cosm:watermark";

export interface CosmGroup {
  key: string;
  group: string;
  source: Source;
  userAgent: string;
  rooms: Record<number, string>;
}

export const COSM_GROUPS: Record<string, CosmGroup> = {
  "equal-love": {
    key: "equal-love",
    group: "=LOVE",
    source: "=LOVE LINK",
    userAgent: "io.cosm.fc.user.equal.love/1.3.11/Android/12/SM-S916U",
    rooms: {
      1: "大谷映美里", 2: "大場花菜", 3: "音嶋莉沙", 4: "齋藤樹愛羅", 5: "佐々木舞香",
      6: "髙松瞳", 7: "瀧脇笙古", 8: "野口衣織", 9: "諸橋沙夏", 10: "山本杏奈",
    },
  },
  "not-equal-me": {
    key: "not-equal-me",
    group: "≠ME",
    source: "≠ME LINK",
    userAgent: "io.cosm.fc.user.not.equal.me/1.3.11/Android/12/SM-S916U",
    rooms: {
      34: "尾木波菜", 35: "落合希来里", 36: "蟹沢萌子", 37: "河口夏音", 38: "川中子奈月心",
      39: "櫻井もも", 40: "鈴木瞳美", 41: "谷崎早耶", 42: "冨田菜々風", 43: "永田詩央里",
      44: "本田珠由記",
    },
  },
  "nearly-equal-joy": {
    key: "nearly-equal-joy",
    group: "≒JOY",
    source: "≒JOY LINK",
    userAgent: "io.cosm.fc.user.nearly.equal.joy/1.3.11/Android/12/SM-S916U",
    rooms: {
      45: "逢田珠里依", 46: "天野香乃愛", 47: "市原愛弓", 48: "江角怜音", 49: "大信田美月",
      50: "大西葵", 51: "小澤愛実", 52: "髙橋舞", 53: "藤沢莉子", 54: "村山結香",
      55: "山田杏佳", 56: "山野愛月",
    },
  },
};

/** The env var holding a group's x-artist-group-uuid, e.g. COSM_EQUAL_LOVE_UUID. */
function uuidFor(key: string): string | null {
  const prefix = key.toUpperCase().replace(/-/g, "_");
  return process.env[`COSM_${prefix}_UUID`] || null;
}

/** The COSM group that owns a talk room, or null if the id is unknown. */
function groupForRoom(roomId: number): CosmGroup | null {
  for (const group of Object.values(COSM_GROUPS)) {
    if (roomId in group.rooms) return group;
  }
  return null;
}

/** True when a login is possible: credentials present. */
export function isConfigured(): boolean {
  return Boolean(process.env.COSM_USERNAME && process.env.COSM_PASSWORD);
}

/** Every room across the groups that actually have a uuid configured. */
export function allRoomIds(): number[] {
  const ids: number[] = [];
  for (const group of Object.values(COSM_GROUPS)) {
    if (!uuidFor(group.key)) continue;
    ids.push(...Object.keys(group.rooms).map(Number));
  }
  return ids;
}

interface CosmMedia {
  id?: number | string;
  contentType?: string;
  url?: string;
  compressedUrl?: string;
  durationInSecs?: number | string;
}

interface CosmMessage {
  id: number | string;
  textContent?: string;
  postedDate?: number | string;
  postedUsername?: string;
  chatMedia?: CosmMedia[];
  postedUserProfileUrl?: string;
  postedUserIconUrl?: string;
  isMine?: boolean;
}

interface ChatPage {
  result?: boolean;
  message?: string;
  data?: CosmMessage[];
  nextPageId?: number | string | null;
}

function headers(userAgent: string, uuid: string, token?: string): Record<string, string> {
  return {
    "User-Agent": userAgent,
    "Accept-Language": "ja",
    "X-Artist-Group-UUID": uuid,
    Authorization: token ? `Bearer ${token}` : "Bearer",
  };
}

/** Protobuf varint encoder (little-endian base-128). */
function encodeVarint(value: number): number[] {
  const out: number[] = [];
  let v = value;
  do {
    const byte = v & 0x7f;
    v >>>= 7;
    out.push(v ? byte | 0x80 : byte);
  } while (v);
  return out;
}

/** Encode a length-delimited (wire type 2) protobuf string field. */
function encodeStringField(fieldNumber: number, value: string): number[] {
  const bytes = Buffer.from(value, "utf8");
  return [...encodeVarint((fieldNumber << 3) | 2), ...encodeVarint(bytes.length), ...bytes];
}

/** Read a protobuf varint; returns [value, nextOffset]. */
function readVarint(data: Uint8Array, offset: number): [number, number] {
  let result = 0;
  let shift = 0;
  let o = offset;
  for (;;) {
    const byte = data[o];
    o += 1;
    result |= (byte & 0x7f) << shift;
    if (!(byte & 0x80)) break;
    shift += 7;
  }
  return [result, o];
}

/** Pull field 1 (accessToken) out of the protobuf LoginResponse. */
function decodeAccessToken(data: Uint8Array): string | null {
  let offset = 0;
  let token: string | null = null;
  while (offset < data.length) {
    const [tag, afterTag] = readVarint(data, offset);
    offset = afterTag;
    const field = tag >>> 3;
    const wire = tag & 0x07;
    if (wire === 2) {
      const [len, afterLen] = readVarint(data, offset);
      const end = afterLen + len;
      if (field === 1) token = Buffer.from(data.subarray(afterLen, end)).toString("utf8");
      offset = end;
    } else if (wire === 0) {
      offset = readVarint(data, offset)[1];
    } else if (wire === 1) {
      offset += 8;
    } else if (wire === 5) {
      offset += 4;
    } else {
      break;
    }
  }
  return token;
}

async function login(group: CosmGroup, uuid: string): Promise<string> {
  const stored = (await readState<string>("cosm:rvk"))?.trim();
  const rvk = stored || process.env.COSM_REQUEST_VERIFICATION_KEY?.trim();
  if (!rvk) {
    throw new Error(
      "COSM verification key is not set — paste the x-request-verification-key header (LINK portal → DevTools → Network) into Setup.",
    );
  }
  const body = Buffer.from([
    ...encodeStringField(1, process.env.COSM_USERNAME ?? ""),
    ...encodeStringField(2, process.env.COSM_PASSWORD ?? ""),
  ]);
  const res = await fetch(`${AUTH_BASE}/auth.v1.AuthService/Login`, {
    method: "POST",
    headers: {
      "User-Agent": group.userAgent,
      "Accept-Language": "ja",
      "Content-Type": "application/proto",
      "Connect-Protocol-Version": "1",
      "X-Artist-Group-UUID": uuid,
      "X-Request-Verification-Key": rvk,
    },
    body,
  });
  if (!res.ok) throw new Error(`cosm login ${res.status}`);
  const token = decodeAccessToken(new Uint8Array(await res.arrayBuffer()));
  if (!token) throw new Error("cosm login returned no accessToken");
  return token;
}

interface RoomResult {
  messages: CosmMessage[];
  newestId: string | null;
}

async function fetchRoom(
  group: CosmGroup,
  uuid: string,
  token: string,
  roomId: number,
  stopAtId: string | null,
  maxPages = 40,
): Promise<RoomResult> {
  const out: CosmMessage[] = [];
  let pageStartId: string | null = null;
  let newestId: string | null = null;

  for (let page = 0; page < maxPages; page += 1) {
    const params = new URLSearchParams({
      page: "1", pageSize: "30", hasMedia: "false", mediaType: "0",
      isFavorite: "false", isSentFanLetter: "false", dateSearchInSecs: "0", orderBy: "1",
    });
    if (pageStartId) params.set("pageStartId", pageStartId);

    const res = await fetch(`${API_BASE}/user/v2/chat/${roomId}?${params.toString()}`, {
      headers: headers(group.userAgent, uuid, token),
    });
    if (!res.ok) throw new Error(`cosm chat ${roomId} ${res.status}`);
    const body = (await res.json()) as ChatPage;
    if (body.result === false) throw new Error(`cosm chat ${roomId} error: ${body.message ?? "unknown"}`);

    const messages = body.data ?? [];
    if (newestId === null && messages.length) newestId = String(messages[0].id);

    let hitWatermark = false;
    for (const m of messages) {
      if (stopAtId !== null && String(m.id) === stopAtId) {
        hitWatermark = true;
        break;
      }
      out.push(m);
    }
    if (hitWatermark) break;

    const next = body.nextPageId;
    if (!messages.length || next == null || String(next) === pageStartId) break;
    pageStartId = String(next);
  }

  return { messages: out, newestId };
}

/**
 * Best-effort media kind from COSM's own fields. The ingest layer refines this
 * from the stored file's real content-type, but keep it honest here too:
 * voice notes carry a duration and an audio content-type, so they must not be
 * lumped in with video.
 */
function mediaKind(media: CosmMedia): MediaType {
  const ct = (media.contentType ?? "").toLowerCase();
  if (ct.startsWith("audio")) return "audio";
  if (ct.startsWith("video")) return "video";
  if (ct.startsWith("image")) return "image";
  // No content type: a positive duration means a clip; in LINK talk rooms a
  // text-less clip is overwhelmingly a voice note.
  return Number(media.durationInSecs ?? 0) > 0 ? "audio" : "image";
}

function mediaUrl(media: CosmMedia): string | null {
  const url = media.url || media.compressedUrl || null;
  return url && /^https?:\/\//.test(url) ? url : null;
}

function toEpochMs(value: number | string | undefined): number {
  if (value == null) return Date.now();
  const n = typeof value === "number" ? value : Number(value);
  if (Number.isFinite(n)) return n < 1e12 ? n * 1000 : n;
  const parsed = Date.parse(String(value));
  return Number.isNaN(parsed) ? Date.now() : parsed;
}

function displayTime(epochMs: number, now = Date.now()): string {
  const d = new Date(epochMs);
  if (new Date(now).toDateString() === d.toDateString()) {
    return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
  }
  return `${d.toLocaleString("en-US", { month: "short" })} ${d.getDate()}`;
}

function mapMessages(group: CosmGroup, roomId: number, decoded: CosmMessage[]): NormalizedMessage[] {
  const now = Date.now();
  return decoded.map((m) => {
    const media = m.chatMedia?.[0];
    const url = media ? mediaUrl(media) : null;
    const mediaType: MediaType = media ? mediaKind(media) : "image";
    const createdAt = toEpochMs(m.postedDate);
    return {
      ingestSource: "cosm" as const,
      externalId: String(m.id),
      source: group.source,
      attributionKey: `cosm:${roomId}`,
      senderName: m.postedUsername ?? "",
      // Voice notes carry the literal label "ボイス投稿"; drop it so it's a media-
      // only row (no pointless "Voice post" translation).
      jp: mediaType === "audio" ? "" : (m.textContent ?? ""),
      time: displayTime(createdAt, now),
      createdAt,
      imageUrl: url,
      mediaType,
    };
  });
}

/**
 * Fetch the given rooms incrementally (from each room's watermark), normalise,
 * and advance the watermark. Rooms whose group has no configured uuid are
 * skipped. The caller ingests the returned messages; the server dedupes.
 */
export async function collectRooms(roomIds: number[]): Promise<NormalizedMessage[]> {
  if (!isConfigured()) throw new Error("COSM_USERNAME / COSM_PASSWORD are not set.");

  const byGroup = roomsByGroup(roomIds);

  const watermark = (await readState<Record<string, string>>(WATERMARK_KEY)) ?? {};
  const out: NormalizedMessage[] = [];

  for (const [key, ids] of Object.entries(byGroup)) {
    const group = COSM_GROUPS[key];
    const uuid = uuidFor(key);
    if (!uuid) continue;
    const token = await login(group, uuid);
    for (const roomId of ids) {
      const wmKey = `cosm:${roomId}`;
      const { messages, newestId } = await fetchRoom(group, uuid, token, roomId, watermark[wmKey] ?? null);
      out.push(...mapMessages(group, roomId, messages));
      try {
        await backfillAvatar(group, uuid, token, roomId, messages);
      } catch (error) {
        console.error(`[cosm] avatar backfill failed for room ${roomId}`, error);
      }
      if (newestId) watermark[wmKey] = newestId;
    }
  }

  await writeState(WATERMARK_KEY, watermark);
  return out;
}

/** Group requested rooms by their owning COSM group (so we log in once each). */
function roomsByGroup(roomIds: number[]): Record<string, number[]> {
  const byGroup: Record<string, number[]> = {};
  for (const id of roomIds) {
    const group = groupForRoom(id);
    if (group) (byGroup[group.key] ??= []).push(id);
  }
  return byGroup;
}

/**
 * Capture a member's profile image once. COSM only exposes it inside chat
 * (`postedUserProfileUrl`, a signed ~15-min GCS link), so download and store it
 * durably the first time we see the room, then stop. Never throws to the caller.
 */
async function backfillAvatar(
  group: CosmGroup,
  uuid: string,
  token: string,
  roomId: number,
  sampled: CosmMessage[],
): Promise<void> {
  const member = await memberForKey(`cosm:${roomId}`);
  if (!member || member.avatarUrl) return;
  let src = sampled.find((m) => !m.isMine && m.postedUserProfileUrl)?.postedUserProfileUrl;
  if (!src) {
    const { messages } = await fetchRoom(group, uuid, token, roomId, null, 1);
    src = messages.find((m) => !m.isMine && m.postedUserProfileUrl)?.postedUserProfileUrl;
  }
  if (!src) return;
  const res = await fetch(src);
  if (!res.ok) return;
  const contentType = res.headers.get("content-type") || "image/jpeg";
  const url = await storeMedia(`cosm-avatar/${roomId}.jpg`, await res.arrayBuffer(), contentType);
  await updateMember(member.id, { avatarUrl: url });
}
