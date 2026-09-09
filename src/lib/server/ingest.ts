import "server-only";

import { put } from "@vercel/blob";

import { messageId, type NormalizedMessage } from "@/lib/ingest";
import { PLACEHOLDER_IMAGE, type Message } from "@/lib/types";
import { insertIngestedExternal, learnAttributionKey, memberForKey, messageExists } from "./db";

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
 * Copy a remote image into Blob during ingest.
 *
 * Source media URLs are short-lived signed links (CloudFront/GCS, ~15 min), so
 * they are fetched the moment we see them and never persisted as-is. A failure
 * here is non-fatal: the message still stores, just without its picture.
 */
async function storeImage(id: string, url: string): Promise<string | null> {
  if (!process.env.BLOB_READ_WRITE_TOKEN) return null;
  try {
    const response = await fetch(url);
    if (!response.ok) {
      console.error(`[ingest] media fetch ${response.status} for ${id}`);
      return null;
    }
    const contentType = response.headers.get("content-type") || "image/jpeg";
    const extension = contentType.split("/")[1]?.split("+")[0]?.split(";")[0] || "jpg";
    const blob = await put(`ingest/${id}.${extension}`, await response.arrayBuffer(), {
      access: "public",
      contentType,
    });
    return blob.url;
  } catch (error) {
    console.error(`[ingest] media store failed for ${id}`, error);
    return null;
  }
}

/**
 * Attribute one normalised message and store it as pending.
 *
 * Returns null when the (ingest_source, external_id) pair already exists, which
 * is the common case on every run after the first — the collector deliberately
 * re-reads overlapping pages and relies on this dedupe.
 */
async function ingestOne(message: NormalizedMessage): Promise<Message | null> {
  const id = messageId(message.ingestSource, message.externalId);
  // Dedupe before the expensive media copy so re-runs (which re-read overlapping
  // pages) skip work instead of re-downloading every file to Blob.
  if (await messageExists(id)) return null;
  const member = await memberForKey(message.attributionKey);
  const jp = withFanName(message.jp);
  const imageUrl =
    message.imageUrl === PLACEHOLDER_IMAGE
      ? PLACEHOLDER_IMAGE
      : message.imageUrl
        ? await storeImage(id, message.imageUrl)
        : null;

  return insertIngestedExternal({
    id,
    ingestSource: message.ingestSource,
    externalId: message.externalId,
    memberId: member?.id ?? null,
    jp,
    time: message.time,
    source: member?.source ?? message.source,
    imageUrl,
    mediaType: message.mediaType,
    long: jp.length > LONG_THRESHOLD,
    createdAt: message.createdAt,
    senderName: message.senderName,
  });
}

export interface IngestBatchResult {
  inserted: Message[];
  scanned: number;
}

/**
 * Ingest a collector batch. Failures are per-message: one bad row never sinks
 * the batch, so a partial network hiccup still stores everything it can and the
 * next run fills the gaps (dedupe makes the overlap free).
 */
export async function ingestBatch(messages: NormalizedMessage[]): Promise<IngestBatchResult> {
  const inserted: Message[] = [];
  for (const message of messages) {
    try {
      const stored = await ingestOne(message);
      if (stored) inserted.push(stored);
    } catch (error) {
      console.error(`[ingest] failed ${message.ingestSource}:${message.externalId}`, error);
    }
  }
  return { inserted, scanned: messages.length };
}

/** Re-exported so the assign flow can teach attribution the same way Gmail does. */
export { learnAttributionKey };
