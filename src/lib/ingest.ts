import { z } from "zod";

import { INGEST_SOURCES, MEDIA_TYPES, PLACEHOLDER_IMAGE, SOURCES, type IngestSource, type MediaType, type Source } from "./types";

/**
 * The contract between the local collector and POST /api/ingest.
 *
 * The collector drives your logged-in browser sessions for the API-based apps
 * (Weverse, Nogizaka, niajoy), normalises whatever each one returns into this
 * one shape, and posts a batch. Everything app-specific — protobuf, HMAC
 * signing, JSON field names — is resolved in the adapter before it gets here, so
 * the server stays ignorant of any single service.
 *
 * This module is deliberately free of `server-only`: the collector imports it
 * too, so the shape can never drift between producer and consumer.
 */

export const NormalizedMessageSchema = z.object({
  /** Which adapter produced this — half of the idempotency key. */
  ingestSource: z.enum(INGEST_SOURCES as unknown as [IngestSource, ...IngestSource[]]),
  /** The service's own native message id — the other half. Stable across runs. */
  externalId: z.string().min(1),
  /** Display source for the UI filter row. */
  source: z.enum(SOURCES as unknown as [Source, ...Source[]]),
  /**
   * Source-scoped routing key, e.g. "nogizaka:68" / "weverse:WROTC91" /
   * "cosm:46". Matched against members.attribution_keys; an unmatched key
   * lands the message in Unassigned until you file it once.
   */
  attributionKey: z.string().min(1),
  /** Human-readable sender, shown while a message is Unassigned. */
  senderName: z.string().default(""),
  /** The Japanese text. May be empty for an image-only message. */
  jp: z.string().default(""),
  /** Display-only timestamp string, already formatted by the adapter. */
  time: z.string().default(""),
  /** Epoch ms, for monotonic ordering within a thread. */
  createdAt: z.number().int().nonnegative(),
  /**
   * What to do about the message's image. One of:
   *   - a remote URL  → the server fetches it and copies it into Blob during
   *     ingest. These are short-lived signed URLs (CloudFront/GCS, ~15 min), so
   *     they are downloaded on arrival, never stored as-is.
   *   - PLACEHOLDER_IMAGE → the message has a photo the source walls off
   *     (niajoy), so we record that a photo exists without bytes behind it,
   *     rendering the app's grey placeholder block.
   *   - null → no image.
   */
  imageUrl: z
    .union([z.string().url(), z.literal(PLACEHOLDER_IMAGE)])
    .nullable()
    .default(null),
  /** Whether imageUrl points at an image or a video. Drives how the UI renders it. */
  mediaType: z
    .enum(MEDIA_TYPES as unknown as [MediaType, ...MediaType[]])
    .default("image"),
});

export type NormalizedMessage = z.infer<typeof NormalizedMessageSchema>;

/** One collector POST. Bounded so a runaway backfill can't submit unbounded work. */
export const IngestBatchSchema = z.object({
  messages: z.array(NormalizedMessageSchema).max(500),
});

export type IngestBatch = z.infer<typeof IngestBatchSchema>;

/** The stable primary key for an ingested row: adapter key + native id. */
export function messageId(ingestSource: IngestSource, externalId: string): string {
  return `${ingestSource}-${externalId}`;
}
