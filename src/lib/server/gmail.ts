import "server-only";

import { put } from "@vercel/blob";
import { google, type gmail_v1 } from "googleapis";

import {
  insertIngested,
  memberForSender,
  readState,
  writeState,
} from "./db";
import type { Message, Source } from "@/lib/types";

/**
 * Gmail ingestion.
 *
 * Flow: Gmail publishes mailbox changes to a Cloud Pub/Sub topic, Pub/Sub
 * pushes them to /api/gmail/push, and we translate `historyId` into actual
 * messages via users.history.list. The push payload never carries the mail
 * itself — only the address and a history cursor.
 */

/* ── state keys ──────────────────────────────────────────────────────────── */

const KEY_TOKENS = "gmail:tokens";
const KEY_HISTORY = "gmail:historyId";
const KEY_WATCH = "gmail:watch";

interface StoredTokens {
  refresh_token: string;
  /** Informational only — the client refreshes access tokens itself. */
  scope?: string;
  obtained_at?: number;
}

export interface WatchState {
  /** Epoch millis. Gmail expires a watch after 7 days. */
  expiration: number;
  labelId: string | null;
  topicName: string;
  registeredAt: number;
}

/** Read-only is all this app ever needs — it never sends or modifies mail. */
const SCOPES = ["https://www.googleapis.com/auth/gmail.readonly"];

export function labelName(): string {
  return process.env.GMAIL_LABEL || "oshi";
}

/* ── auth ────────────────────────────────────────────────────────────────── */

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is not set.`);
  return value;
}

export function redirectUri(): string {
  if (process.env.GOOGLE_REDIRECT_URI) return process.env.GOOGLE_REDIRECT_URI;
  const base = process.env.VERCEL_PROJECT_PRODUCTION_URL
    ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`
    : "http://localhost:3000";
  return `${base}/api/gmail/callback`;
}

function oauthClient() {
  return new google.auth.OAuth2(
    requireEnv("GOOGLE_CLIENT_ID"),
    requireEnv("GOOGLE_CLIENT_SECRET"),
    redirectUri(),
  );
}

export function consentUrl(): string {
  return oauthClient().generateAuthUrl({
    access_type: "offline",
    scope: SCOPES,
    // Force a refresh token even if this account already granted consent once.
    prompt: "consent",
    include_granted_scopes: true,
  });
}

/** Exchange the one-time code for a refresh token and store it. */
export async function completeOAuth(code: string): Promise<void> {
  const client = oauthClient();
  const { tokens } = await client.getToken(code);

  if (!tokens.refresh_token) {
    throw new Error(
      "Google did not return a refresh token. Revoke the app's access at " +
        "myaccount.google.com/permissions and connect again.",
    );
  }

  await writeState<StoredTokens>(KEY_TOKENS, {
    refresh_token: tokens.refresh_token,
    scope: tokens.scope ?? undefined,
    obtained_at: Date.now(),
  });
}

export async function isConnected(): Promise<boolean> {
  return (await readState<StoredTokens>(KEY_TOKENS)) !== null;
}

async function gmailClient(): Promise<gmail_v1.Gmail> {
  const tokens = await readState<StoredTokens>(KEY_TOKENS);
  if (!tokens?.refresh_token) {
    throw new Error("Gmail is not connected. Visit /setup to authorise it.");
  }
  const client = oauthClient();
  // The library exchanges this for a fresh access token on demand.
  client.setCredentials({ refresh_token: tokens.refresh_token });
  return google.gmail({ version: "v1", auth: client });
}

/* ── label + watch ───────────────────────────────────────────────────────── */

async function resolveLabelId(gmail: gmail_v1.Gmail): Promise<string | null> {
  const wanted = labelName().toLowerCase();
  const { data } = await gmail.users.labels.list({ userId: "me" });
  const match = data.labels?.find((label) => label.name?.toLowerCase() === wanted);
  return match?.id ?? null;
}

/**
 * Register (or renew) the Gmail push watch.
 *
 * Must be re-run within 7 days or ingestion stops silently — the cron in
 * vercel.json calls this daily.
 */
export async function registerWatch(): Promise<WatchState> {
  const topicName = requireEnv("GMAIL_PUBSUB_TOPIC");
  const gmail = await gmailClient();
  const labelId = await resolveLabelId(gmail);

  if (!labelId) {
    throw new Error(
      `No Gmail label named "${labelName()}". Create it and file idol mail into it, ` +
        "or set GMAIL_LABEL to an existing label.",
    );
  }

  const { data } = await gmail.users.watch({
    userId: "me",
    requestBody: {
      topicName,
      labelIds: [labelId],
      // Only notify for mail in that label, rather than the whole mailbox.
      labelFilterBehavior: "INCLUDE",
    },
  });

  const state: WatchState = {
    expiration: Number(data.expiration ?? 0),
    labelId,
    topicName,
    registeredAt: Date.now(),
  };

  await writeState<WatchState>(KEY_WATCH, state);

  // Seed the cursor on first registration so the first push has a start point.
  if (data.historyId && !(await readState<string>(KEY_HISTORY))) {
    await writeState<string>(KEY_HISTORY, String(data.historyId));
  }

  return state;
}

export async function watchState(): Promise<WatchState | null> {
  return readState<WatchState>(KEY_WATCH);
}

/* ── message parsing ─────────────────────────────────────────────────────── */

interface ParsedMail {
  gmailMessageId: string;
  fromEmail: string;
  fromName: string;
  text: string;
  time: string;
  image: { data: Buffer; mimeType: string } | null;
}

function header(payload: gmail_v1.Schema$MessagePart | undefined, name: string): string {
  const found = payload?.headers?.find((h) => h.name?.toLowerCase() === name.toLowerCase());
  return found?.value ?? "";
}

/** `"Ayumi <a@b.jp>"` → name and address. Bare addresses are handled too. */
function parseFrom(raw: string): { name: string; email: string } {
  const angled = raw.match(/^\s*(.*?)\s*<([^>]+)>\s*$/);
  if (angled) {
    return {
      name: angled[1].replace(/^["']|["']$/g, "").trim(),
      email: angled[2].trim().toLowerCase(),
    };
  }
  return { name: "", email: raw.trim().toLowerCase() };
}

function decodeBody(data: string | null | undefined): string {
  if (!data) return "";
  // Gmail uses base64url for body data.
  return Buffer.from(data, "base64url").toString("utf8");
}

function stripHtml(html: string): string {
  return html
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|tr|li|h[1-6])>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code)));
}

/** Depth-first walk collecting the plain text, the HTML, and the first image. */
function walkParts(
  part: gmail_v1.Schema$MessagePart | undefined,
  acc: { plain: string[]; html: string[]; imagePart: gmail_v1.Schema$MessagePart | null },
): void {
  if (!part) return;

  const mime = part.mimeType ?? "";

  if (mime === "text/plain") acc.plain.push(decodeBody(part.body?.data));
  else if (mime === "text/html") acc.html.push(decodeBody(part.body?.data));
  else if (mime.startsWith("image/") && part.body?.attachmentId && !acc.imagePart) {
    acc.imagePart = part;
  }

  for (const child of part.parts ?? []) walkParts(child, acc);
}

/** Trim the trailing unsubscribe/footer noise that mobile mail tends to carry. */
function cleanBody(text: string): string {
  const cut = text.split(/^[-—─═_]{6,}\s*$/m)[0] ?? text;
  return cut
    .split("\n")
    .map((line) => line.trimEnd())
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

async function parseMail(
  gmail: gmail_v1.Gmail,
  messageId: string,
): Promise<ParsedMail | null> {
  const { data } = await gmail.users.messages.get({
    userId: "me",
    id: messageId,
    format: "full",
  });

  const payload = data.payload ?? undefined;
  const acc = { plain: [] as string[], html: [] as string[], imagePart: null as gmail_v1.Schema$MessagePart | null };
  walkParts(payload, acc);

  // A single-part mail carries its body on the payload itself.
  if (!acc.plain.length && !acc.html.length && payload?.body?.data) {
    const body = decodeBody(payload.body.data);
    if ((payload.mimeType ?? "").includes("html")) acc.html.push(body);
    else acc.plain.push(body);
  }

  const text = cleanBody(
    acc.plain.join("\n").trim() || stripHtml(acc.html.join("\n")),
  );
  if (!text) return null;

  const from = parseFrom(header(payload, "From"));

  let image: ParsedMail["image"] = null;
  if (acc.imagePart?.body?.attachmentId) {
    try {
      const attachment = await gmail.users.messages.attachments.get({
        userId: "me",
        messageId,
        id: acc.imagePart.body.attachmentId,
      });
      if (attachment.data.data) {
        image = {
          data: Buffer.from(attachment.data.data, "base64url"),
          mimeType: acc.imagePart.mimeType ?? "image/jpeg",
        };
      }
    } catch {
      // An unreadable attachment shouldn't cost us the message text.
    }
  }

  const received = Number(data.internalDate ?? Date.now());

  return {
    gmailMessageId: messageId,
    fromEmail: from.email,
    fromName: from.name || from.email,
    text,
    time: new Date(received).toLocaleTimeString([], {
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    }),
    image: image,
  };
}

/* ── ingestion ───────────────────────────────────────────────────────────── */

/** Gmail is one of the four sources the design already models. */
const INGEST_SOURCE: Source = "Mobile Mail";
const LONG_THRESHOLD = 90;

async function storeImage(messageId: string, image: NonNullable<ParsedMail["image"]>) {
  if (!process.env.BLOB_READ_WRITE_TOKEN) return null;
  const extension = image.mimeType.split("/")[1]?.split("+")[0] || "jpg";
  try {
    const blob = await put(`mail/${messageId}.${extension}`, image.data, {
      access: "public",
      contentType: image.mimeType,
    });
    return blob.url;
  } catch (error) {
    console.error("[gmail] blob upload failed", error);
    return null;
  }
}

/**
 * Insert one parsed mail, attributing it to a member by sender address.
 *
 * Unrecognised senders are stored with a null member_id and surface in the
 * app's Unassigned bucket, rather than being guessed at or dropped.
 */
async function ingestOne(gmail: gmail_v1.Gmail, messageId: string): Promise<Message | null> {
  const mail = await parseMail(gmail, messageId);
  if (!mail) return null;

  const member = await memberForSender(mail.fromEmail);
  const imageUrl = mail.image ? await storeImage(messageId, mail.image) : null;

  return insertIngested({
    id: `gm-${messageId}`,
    memberId: member?.id ?? null,
    jp: mail.text,
    romaji: "",
    en: "",
    words: [],
    time: mail.time,
    source: member?.source ?? INGEST_SOURCE,
    imageUrl,
    long: mail.text.length > LONG_THRESHOLD,
    status: "pending",
    createdAt: Date.now(),
    gmailMessageId: mail.gmailMessageId,
    fromEmail: mail.fromEmail,
    fromName: mail.fromName,
  });
}

export interface IngestResult {
  inserted: Message[];
  scanned: number;
  /** Set when history was unusable and we fell back to listing the label. */
  usedFallback: boolean;
}

/**
 * Pull everything new since the stored history cursor.
 *
 * Gmail only retains history for about a week, so a stale cursor returns 404.
 * That falls back to listing recent mail in the label — the unique constraint
 * on gmail_message_id makes re-scanning harmless.
 */
export async function ingestSince(notifiedHistoryId?: string): Promise<IngestResult> {
  const gmail = await gmailClient();
  const watch = await watchState();
  const labelId = watch?.labelId ?? (await resolveLabelId(gmail));

  const cursor = await readState<string>(KEY_HISTORY);
  const ids = new Set<string>();
  let usedFallback = false;

  if (cursor) {
    try {
      let pageToken: string | undefined;
      do {
        const { data } = await gmail.users.history.list({
          userId: "me",
          startHistoryId: cursor,
          historyTypes: ["messageAdded"],
          ...(labelId ? { labelId } : {}),
          maxResults: 200,
          pageToken,
        });

        for (const entry of data.history ?? []) {
          for (const added of entry.messagesAdded ?? []) {
            if (added.message?.id) ids.add(added.message.id);
          }
        }
        pageToken = data.nextPageToken ?? undefined;
      } while (pageToken);
    } catch (error) {
      // 404 means the cursor aged out of Gmail's history window.
      console.warn("[gmail] history unusable, falling back to label listing", error);
      usedFallback = true;
    }
  } else {
    usedFallback = true;
  }

  if (usedFallback && labelId) {
    const { data } = await gmail.users.messages.list({
      userId: "me",
      labelIds: [labelId],
      maxResults: 25,
    });
    for (const message of data.messages ?? []) {
      if (message.id) ids.add(message.id);
    }
  }

  const inserted: Message[] = [];
  for (const id of ids) {
    try {
      const message = await ingestOne(gmail, id);
      if (message) inserted.push(message);
    } catch (error) {
      console.error(`[gmail] failed to ingest ${id}`, error);
    }
  }

  // Advance the cursor only after the batch is stored, so a crash mid-batch
  // replays rather than skipping.
  const nextCursor = notifiedHistoryId ?? (await currentHistoryId(gmail));
  if (nextCursor) await writeState<string>(KEY_HISTORY, String(nextCursor));

  return { inserted, scanned: ids.size, usedFallback };
}

async function currentHistoryId(gmail: gmail_v1.Gmail): Promise<string | null> {
  const { data } = await gmail.users.getProfile({ userId: "me" });
  return data.historyId ? String(data.historyId) : null;
}
