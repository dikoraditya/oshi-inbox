import "server-only";

import { messageId, type NormalizedMessage } from "@/lib/ingest";
import { PLACEHOLDER_IMAGE, type MediaType, type Message } from "@/lib/types";
import { insertIngestedExternal, learnAttributionKey, memberForKey, messageMediaState, updateMessageMedia } from "./db";
import { storeMedia } from "./media";

/**
 * Source-agnostic ingestion for the collector's API-based apps.
 *
 * The Gmail path (server/gmail.ts) parses mail and calls insertIngested; this is
 * its sibling for everything the collector posts. Both converge on the same
 * "store pending, attribute by a learned key, surface unknowns in Unassigned"
 * behaviour — only the provenance column and the key namespace differ.
 */

const LONG_THRESHOLD = 90;

/**
 * The fan's registered name. Idol mobame (Nogizaka) writes the recipient's name
 * as the `%%%` placeholder for the app to fill in; substitute it here so the
 * stored text — and its translation — read naturally. Unset leaves `%%%`.
 */
const FAN_NICKNAME = process.env.FAN_NICKNAME?.trim();
function withFanName(jp: string): string {
  return FAN_NICKNAME ? jp.replaceAll("%%%", FAN_NICKNAME) : jp;
}

/**
 * Copy a remote image or video into media storage during ingest.
 *
 * Source media URLs are short-lived signed links (CloudFront/GCS, ~15 min), so
 * they are fetched the moment we see them and never persisted as-is. A failure
 * here is non-fatal: the message still stores, just without its picture.
 */
/** How the UI should render a stored file, from its authoritative content-type. */
function mediaTypeFor(contentType: string): MediaType {
  const ct = contentType.toLowerCase();
  if (ct.startsWith("audio/")) return "audio";
  if (ct.startsWith("video/")) return "video";
  return "image";
}

async function storeImage(id: string, url: string): Promise<{ url: string; mediaType: MediaType } | null> {
  try {
    const response = await fetch(url);
    if (!response.ok) {
      console.error(`[ingest] media fetch ${response.status} for ${id}`);
      return null;
    }
    const contentType = response.headers.get("content-type") || "image/jpeg";
    const extension = contentType.split("/")[1]?.split("+")[0]?.split(";")[0] || "jpg";
    const stored = await storeMedia(`ingest/${id}.${extension}`, await response.arrayBuffer(), contentType);
    return { url: stored, mediaType: mediaTypeFor(contentType) };
  } catch (error) {
    console.error(`[ingest] media store failed for ${id}`, error);
    return null;
  }
}

type IngestOutcome =
  | { status: "inserted"; message: Message }
  | { status: "repaired" }
  | { status: "skipped" };

/**
 * Attribute one normalised message and store it as pending.
 *
 * On a re-run the row usually already exists, so this dedupes to `skipped`. The
 * one write it still does on an existing row is `repaired`: attaching media that
 * a previous run failed to copy. Otherwise it `inserted` a new pending row.
 */

async function ingestOne(message: NormalizedMessage): Promise<IngestOutcome> {
  const id = messageId(message.ingestSource, message.externalId);
  const hasIncomingMedia = Boolean(message.imageUrl) && message.imageUrl !== PLACEHOLDER_IMAGE;

  // Dedupe before the expensive media copy so re-runs (which re-read overlapping
  // pages) skip work instead of re-downloading every file. One exception: a row
  // whose media copy previously failed (null image_url) is repaired in place
  // when the source offers the file again — its translation is left untouched.
  const existing = await messageMediaState(id);
  if (existing.exists) {
    if (!existing.imageUrl && hasIncomingMedia) {
      const stored = await storeImage(id, message.imageUrl as string);
      if (stored) {
        await updateMessageMedia(id, stored.url, stored.mediaType);
        return { status: "repaired" };
      }
    }
    return { status: "skipped" };
  }

  const member = await memberForKey(message.attributionKey);
  const jp = withFanName(message.jp);
  // The stored file's own content-type is authoritative over the adapter's
  // guess — COSM voice notes (audio/m4a) would otherwise be miscounted as video.
  let imageUrl: string | null;
  let mediaType: MediaType = message.mediaType;
  if (message.imageUrl === PLACEHOLDER_IMAGE) {
    imageUrl = PLACEHOLDER_IMAGE;
  } else if (message.imageUrl) {
    const stored = await storeImage(id, message.imageUrl);
    imageUrl = stored?.url ?? null;
    if (stored) mediaType = stored.mediaType;
  } else {
    imageUrl = null;
  }

  const inserted = await insertIngestedExternal({
    id,
    ingestSource: message.ingestSource,
    externalId: message.externalId,
    memberId: member?.id ?? null,
    jp,
    time: message.time,
    source: member?.source ?? message.source,
    imageUrl,
    mediaType,
    long: jp.length > LONG_THRESHOLD,
    createdAt: message.createdAt,
    senderName: message.senderName,
  });
  return inserted ? { status: "inserted", message: inserted } : { status: "skipped" };
}

export interface IngestBatchResult {
  inserted: Message[];
  repaired: number;
  scanned: number;
}

/**
 * Ingest a collector batch. Failures are per-message: one bad row never sinks
 * the batch, so a partial network hiccup still stores everything it can and the
 * next run fills the gaps (dedupe makes the overlap free).
 */
export async function ingestBatch(messages: NormalizedMessage[]): Promise<IngestBatchResult> {
  const inserted: Message[] = [];
  let repaired = 0;
  for (const message of messages) {
    try {
      const outcome = await ingestOne(message);
      if (outcome.status === "inserted") inserted.push(outcome.message);
      else if (outcome.status === "repaired") repaired += 1;
    } catch (error) {
      console.error(`[ingest] failed ${message.ingestSource}:${message.externalId}`, error);
    }
  }
  return { inserted, repaired, scanned: messages.length };
}

/** Re-exported so the assign flow can teach attribution the same way Gmail does. */
export { learnAttributionKey };
