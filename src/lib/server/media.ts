import "server-only";

import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

import { put } from "@vercel/blob";

/**
 * One place that persists a media object (image or video) and hands back a
 * public URL to store on the message row.
 *
 * Three backends, chosen at runtime so the same app runs cloud, fully local, or
 * mirrored to both:
 *
 *   blob   → Vercel Blob (`put`). What a Vercel deployment uses; its filesystem
 *            is read-only/ephemeral, so disk is not an option there.
 *   local  → the machine's own disk under public/, served by Next as a plain
 *            static file. Free and unbounded for a local run, and — unlike an
 *            API route — the static handler answers HTTP range requests, so
 *            `<video>` scrubbing works.
 *   both   → write the bytes to Blob *and* disk for redundancy. The row can only
 *            hold one URL, so `MEDIA_PRIMARY` (default `blob`) picks which one is
 *            canonical; the other is a mirror. Each write is best-effort — if the
 *            primary fails but the mirror succeeds, the mirror's URL is returned,
 *            so one backend being down never drops the media.
 *
 * Selection: `MEDIA_STORAGE` wins when set to `local`, `blob`, or `both`;
 * otherwise fall back to Blob when a token is present and local disk when it is
 * not, so a bare `npm run dev` with no cloud config stores media locally.
 */

export type MediaBackend = "local" | "blob" | "both";

export function mediaBackend(): MediaBackend {
  const explicit = process.env.MEDIA_STORAGE?.trim().toLowerCase();
  if (explicit === "local" || explicit === "blob" || explicit === "both") return explicit;
  return process.env.BLOB_READ_WRITE_TOKEN ? "blob" : "local";
}

/** Which backend's URL is stored on the row in `both` mode. Default: Blob, so a
 * deployment serves media from the CDN and disk is the backup. */
function primaryBackend(): "local" | "blob" {
  return process.env.MEDIA_PRIMARY?.trim().toLowerCase() === "local" ? "local" : "blob";
}

/** Bytes any caller might hold: a fetch body, a Gmail attachment, an upload. */
type MediaData = ArrayBuffer | Uint8Array | Blob;

/** Public URL prefix mapping onto the on-disk media directory. */
const LOCAL_URL_PREFIX = "/media";

async function toBuffer(data: MediaData): Promise<Buffer> {
  if (Buffer.isBuffer(data)) return data;
  if (data instanceof Uint8Array) return Buffer.from(data);
  if (data instanceof ArrayBuffer) return Buffer.from(new Uint8Array(data));
  return Buffer.from(await data.arrayBuffer());
}

async function writeToBlob(key: string, body: Buffer, contentType: string): Promise<string> {
  const blob = await put(key, body, { access: "public", contentType });
  return blob.url;
}

async function writeToDisk(key: string, body: Buffer): Promise<string> {
  const relative = key.replace(/^\/+/, "");
  // Must live inside public/ so Next serves it; MEDIA_DIR overrides the mount.
  const baseDir = process.env.MEDIA_DIR?.trim() || path.join(process.cwd(), "public", "media");
  const dest = path.join(baseDir, relative);
  await mkdir(path.dirname(dest), { recursive: true });
  await writeFile(dest, body);
  return `${LOCAL_URL_PREFIX}/${relative.split(path.sep).join("/")}`;
}

/**
 * Store one media object under `key` (a source-scoped relative path like
 * `ingest/abc.jpg`) and return its public URL. In Blob mode `key` is the Blob
 * pathname; on disk it is the path under public/media, nested dirs created as
 * needed.
 */
export async function storeMedia(
  key: string,
  data: MediaData,
  contentType: string,
): Promise<string> {
  const body = await toBuffer(data);
  const backend = mediaBackend();

  if (backend === "local") return writeToDisk(key, body);

  if (backend === "blob") {
    try {
      return await writeToBlob(key, body, contentType);
    } catch (error) {
      // Blob rejected it — most likely the store is full / over quota. Don't drop
      // the media: keep a local copy so `media:sync-to-blob` can push it up once
      // Blob has room again. On Vercel's read-only fs this second write also
      // throws, leaving behaviour unchanged there.
      console.error(`[media] blob write failed for ${key}, falling back to disk`, error);
      return writeToDisk(key, body);
    }
  }

  // both: mirror to each, best-effort, and keep the primary's URL as canonical.
  const [blobResult, localResult] = await Promise.allSettled([
    writeToBlob(key, body, contentType),
    writeToDisk(key, body),
  ]);
  if (blobResult.status === "rejected") console.error(`[media] blob write failed for ${key}`, blobResult.reason);
  if (localResult.status === "rejected") console.error(`[media] local write failed for ${key}`, localResult.reason);

  const blobUrl = blobResult.status === "fulfilled" ? blobResult.value : null;
  const localUrl = localResult.status === "fulfilled" ? localResult.value : null;
  const canonical = primaryBackend() === "local" ? localUrl ?? blobUrl : blobUrl ?? localUrl;
  if (!canonical) throw new Error(`both media writes failed for ${key}`);
  return canonical;
}
