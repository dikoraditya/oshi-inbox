/**
 * Domain model.
 *
 * The design canvas stored each message as a positional tuple —
 * [jp, romaji, en, words[[jp, romaji, gloss]], opts]. That is fine for a
 * prototype but miserable to persist and migrate, so everything is normalised
 * into named records here. `src/lib/seed.ts` does the conversion once.
 */

/** The apps Oshi Inbox aggregates. Order matters — it drives the filter row. */
export const SOURCES = [
  "Weverse DM",
  "≒JOY LINK",
  "=LOVE LINK",
  "≠ME LINK",
  "Nogizaka Mail",
  "NMB48 Talk",
  "Mobile Mail",
] as const;
export type Source = (typeof SOURCES)[number];

/**
 * Adapter keys for the collector's API-based sources — the value stored in
 * messages.ingest_source. Distinct from the display Source above: this is the
 * integration that produced a row, and half of its idempotency key.
 */
export const INGEST_SOURCES = ["weverse", "nogizaka", "cosm", "bstage"] as const;
export type IngestSource = (typeof INGEST_SOURCES)[number];

/**
 * Groups come from the database — the Roster screen can add one — so this is a
 * plain string rather than a closed union. GROUP_ORDER is only the initial seed.
 *
 * Sources are the opposite: a fixed property of the app, because each one is a
 * separate integration rather than a label you invent.
 */
export const GROUP_ORDER = ["AKB48", "Nogizaka46", "≒JOY", "=LOVE", "≠ME", "NMB48"] as const;
export type Group = string;

export interface Member {
  id: string;
  name: string;
  group: Group;
  /** The app this member normally writes from. Seeds the editor's Source picker. */
  source: Source;
  unread: number;
  /** Display-only clock/date string, exactly as the design treats it. */
  time: string;
  /**
   * Sender addresses that attribute to this member. Learned when you assign an
   * unassigned ingested mail — the next one from that address routes itself.
   */
  emailAddresses: string[];
  /** Source-scoped ingest keys (e.g. "cosm:46") that route messages here. */
  attributionKeys: string[];
  /** Profile image — from the source or set on the Edit Profile screen. */
  avatarUrl: string | null;
  /** Blog link, user-set, for future blog capture. */
  blogUrl: string | null;
}

/** One tappable vocabulary item inside a message. */
export interface Gloss {
  jp: string;
  romaji: string;
  gloss: string;
}

/**
 * Translation lifecycle.
 *
 * A message with `pending` renders the design's "Awaiting translation" strip.
 * `failed` is ours — the canvas had no notion of the translator erroring.
 */
export type TranslationStatus = "pending" | "done" | "failed";

/** How a message's attached media renders. */
export const MEDIA_TYPES = ["image", "video", "audio"] as const;
export type MediaType = (typeof MEDIA_TYPES)[number];

/** Seed messages depict a photo that has no bytes behind it. */
export const PLACEHOLDER_IMAGE = "__placeholder__";

export interface Message {
  id: string;
  /**
   * Null while an ingested mail is unassigned — the sender was not recognised
   * and is waiting for you to say who it is.
   */
  memberId: string | null;
  /** The only field the user actually types. Everything below is derived. */
  jp: string;
  romaji: string;
  en: string;
  words: Gloss[];
  /** Display-only timestamp string. */
  time: string;
  /** Overrides the member's default source for this one message. */
  source: Source;
  /** Vercel Blob URL, the PLACEHOLDER_IMAGE sentinel, or null. */
  imageUrl: string | null;
  /** Whether imageUrl points at an image or a video. Defaults to image. */
  mediaType?: MediaType;
  /** Long messages clamp to `collapsedSentences` with a read-more. */
  long: boolean;
  status: TranslationStatus;
  /** Only set when status is "failed" — surfaced in the thread so retries make sense. */
  error?: string | null;
  /** Monotonic ordering within a thread; survives edits. */
  createdAt: number;

  /* ── ingestion provenance (null for anything captured by hand) ─────────── */

  /** Gmail's message id. Unique, and what makes webhook delivery idempotent. */
  gmailMessageId?: string | null;
  fromEmail?: string | null;
  fromName?: string | null;
}

/** User-tunable reading settings — the two props the design canvas exposed. */
export interface Settings {
  /** Show the English block without being asked. Design default: false. */
  englishByDefault: boolean;
  /** How many sentences a long message clamps to. Design default: 2. */
  collapsedSentences: number;
}

export const DEFAULT_SETTINGS: Settings = {
  englishByDefault: false,
  collapsedSentences: 2,
};

/** What the translator route returns for one message. */
export interface TranslationResult {
  romaji: string;
  en: string;
  words: Gloss[];
}
