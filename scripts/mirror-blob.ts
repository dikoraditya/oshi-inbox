/**
 * Mirror every file already in your Vercel Blob store down to local disk, so
 * media uploaded before the local/both storage option exists gets a local
 * backup too.
 *
 *   npm run media:mirror-local
 *
 * Blob pathnames are the same keys the app writes (`ingest/…`, `mail/…`,
 * `capture/…`), so each blob lands at `public/media/<pathname>` — exactly where
 * `storeMedia` would have written it. It only copies bytes; it does NOT touch
 * the database, so rows keep pointing at their Blob URLs (the local copies are a
 * cold backup). Idempotent: a file already on disk with the same size is skipped,
 * so re-running only fetches what's missing.
 *
 * Needs BLOB_READ_WRITE_TOKEN (the same token the app uses). Honours MEDIA_DIR.
 */

import { mkdir, stat, writeFile } from "node:fs/promises";
import path from "node:path";

import { list } from "@vercel/blob";
import "dotenv/config";

if (!process.env.BLOB_READ_WRITE_TOKEN) {
  console.error("BLOB_READ_WRITE_TOKEN is not set — put it in .env.local (from your Vercel Blob store).");
  process.exit(1);
}

const baseDir = process.env.MEDIA_DIR?.trim() || path.join(process.cwd(), "public", "media");

async function fileSize(dest: string): Promise<number | null> {
  try {
    return (await stat(dest)).size;
  } catch {
    return null;
  }
}

async function main(): Promise<void> {
  let cursor: string | undefined;
  let downloaded = 0;
  let skipped = 0;
  let failed = 0;
  let bytes = 0;

  do {
    const page = await list({ cursor, limit: 1000 });
    for (const blob of page.blobs) {
      const dest = path.join(baseDir, blob.pathname);
      if ((await fileSize(dest)) === blob.size) {
        skipped += 1;
        continue;
      }
      try {
        const response = await fetch(blob.url);
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const body = Buffer.from(await response.arrayBuffer());
        await mkdir(path.dirname(dest), { recursive: true });
        await writeFile(dest, body);
        downloaded += 1;
        bytes += body.length;
      } catch (error) {
        failed += 1;
        console.error(`  failed: ${blob.pathname} — ${error instanceof Error ? error.message : error}`);
      }
    }
    cursor = page.hasMore ? page.cursor : undefined;
  } while (cursor);

  const mb = (bytes / (1024 * 1024)).toFixed(1);
  console.log(`\nMirrored to ${baseDir}`);
  console.log(`  downloaded ${downloaded} (${mb} MB), skipped ${skipped} already present, ${failed} failed.`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
