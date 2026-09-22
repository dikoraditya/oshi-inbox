import { createReadStream } from "node:fs";
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { Readable } from "node:stream";

import sharp from "sharp";

/**
 * Serves self-hosted media from MEDIA_DIR dynamically (no static public/ mount),
 * which fixes two things at once:
 *
 *  1. Size. Source images can be huge (COSM/≒JOY originals run 3–25 MB) but only
 *     render ~560 px wide. Images are resized + re-encoded to WebP on demand — a
 *     25 MB JPEG becomes ~100 KB — and each variant is cached to disk.
 *  2. Freshness. Next's standalone static handler caches the public/ listing at
 *     boot, so a file written *after* startup (an ingest/pull) 404s until a
 *     restart. Reading from disk per request removes that: new media shows at
 *     once.
 *
 * Video/audio stream with HTTP Range so `<video>`/`<audio>` scrubbing works.
 * Gated by middleware like everything else; in-app <img>/<video> send the cookie.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const BASE = process.env.MEDIA_DIR?.trim() || path.join(process.cwd(), "public", "media");
// Cache lives outside the media volume so it is always writable (the volume's
// files may be root-owned) and cheap to discard — it regenerates on demand.
const CACHE = path.join(process.cwd(), ".media-cache");
const RESIZABLE: Record<string, true> = { ".jpg": true, ".jpeg": true, ".png": true, ".webp": true };
const WIDTHS = new Set([320, 640, 1280]);
const IMMUTABLE = "public, max-age=31536000, immutable";

const TYPES: Record<string, string> = {
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".webp": "image/webp",
  ".gif": "image/gif",
  ".mp4": "video/mp4",
  ".m4v": "video/mp4",
  ".mov": "video/quicktime",
  ".m4a": "audio/mp4",
  ".aac": "audio/aac",
  ".mp3": "audio/mpeg",
  ".wav": "audio/wav",
  ".ogg": "audio/ogg",
};

/** Reject path traversal — the resolved path must stay inside BASE. */
function resolveSafe(parts: string[]): string | null {
  const rel = parts.join("/");
  if (!rel || rel.includes("\0")) return null;
  const abs = path.resolve(BASE, rel);
  if (abs !== BASE && !abs.startsWith(BASE + path.sep)) return null;
  return abs;
}

function streamFile(
  abs: string,
  type: string,
  size: number,
  range: { start: number; end: number } | null,
): Response {
  const stream = range ? createReadStream(abs, { start: range.start, end: range.end }) : createReadStream(abs);
  const body = Readable.toWeb(stream) as unknown as ReadableStream;
  if (range) {
    return new Response(body, {
      status: 206,
      headers: {
        "content-type": type,
        "content-range": `bytes ${range.start}-${range.end}/${size}`,
        "accept-ranges": "bytes",
        "content-length": String(range.end - range.start + 1),
        "cache-control": IMMUTABLE,
      },
    });
  }
  return new Response(body, {
    headers: {
      "content-type": type,
      "content-length": String(size),
      "accept-ranges": "bytes",
      "cache-control": IMMUTABLE,
    },
  });
}

function parseRange(header: string | null, size: number): { start: number; end: number } | null {
  if (!header) return null;
  const match = /^bytes=(\d*)-(\d*)$/.exec(header.trim());
  if (!match) return null;
  const start = match[1] ? Number(match[1]) : 0;
  let end = match[2] ? Number(match[2]) : size - 1;
  if (Number.isNaN(start) || Number.isNaN(end)) return null;
  if (end >= size) end = size - 1;
  if (start > end || start < 0) return null;
  return { start, end };
}

async function serveImage(abs: string, rel: string, mtimeMs: number, width: number): Promise<Response> {
  const cacheAbs = path.join(CACHE, `w${width}`, `${rel}.webp`);
  try {
    const cached = await stat(cacheAbs);
    if (cached.mtimeMs >= mtimeMs) return streamFile(cacheAbs, "image/webp", cached.size, null);
  } catch {
    // miss — build below
  }

  let out: Buffer;
  try {
    out = await sharp(await readFile(abs))
      .rotate()
      .resize({ width, withoutEnlargement: true })
      .webp({ quality: 80 })
      .toBuffer();
  } catch {
    // Not a decodable image — serve the original bytes untouched.
    const buf = await readFile(abs);
    return new Response(new Uint8Array(buf), {
      headers: {
        "content-type": TYPES[path.extname(abs).toLowerCase()] ?? "application/octet-stream",
        "cache-control": IMMUTABLE,
      },
    });
  }

  // Best-effort cache; if the write fails we still serve the bytes.
  try {
    await mkdir(path.dirname(cacheAbs), { recursive: true });
    await writeFile(cacheAbs, out);
  } catch {
    // ignore — resize again next time
  }
  return new Response(new Uint8Array(out), {
    headers: { "content-type": "image/webp", "content-length": String(out.length), "cache-control": IMMUTABLE },
  });
}

export async function GET(request: Request, { params }: { params: Promise<{ path: string[] }> }) {
  const { path: parts } = await params;
  const abs = resolveSafe(parts ?? []);
  if (!abs) return new Response("Bad path", { status: 400 });

  let info;
  try {
    info = await stat(abs);
  } catch {
    return new Response("Not found", { status: 404 });
  }
  if (!info.isFile()) return new Response("Not found", { status: 404 });

  const ext = path.extname(abs).toLowerCase();

  if (RESIZABLE[ext]) {
    const requested = Number(new URL(request.url).searchParams.get("w"));
    const width = WIDTHS.has(requested) ? requested : 1280;
    return serveImage(abs, parts.join("/"), info.mtimeMs, width);
  }

  // video / audio / gif / other — stream with Range support.
  return streamFile(
    abs,
    TYPES[ext] ?? "application/octet-stream",
    info.size,
    parseRange(request.headers.get("range"), info.size),
  );
}
