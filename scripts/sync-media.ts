/**
 * Push locally-stored media UP to Vercel Blob — the reverse of
 * `media:mirror-local`. Use it after upgrading Blob: any file that was saved to
 * disk while Blob was full (or in a pure-local run) gets uploaded so the cloud
 * store has everything too.
 *
 *   npm run media:sync-to-blob            # upload + relink rows, for real
 *   npm run media:sync-to-blob -- --dry-run   # show what it would do
 *
 * Steps:
 *   1. Upload every file under public/media that isn't already in the store, at
 *      the same pathname (so keys stay stable).
 *   2. Relink the database: any message whose image_url is a local `/media/...`
 *      path is repointed at its Blob URL, so a Vercel deployment (ephemeral disk)
 *      serves it correctly. Rows already on Blob URLs are untouched.
 *
 * Needs BLOB_READ_WRITE_TOKEN. Relinking additionally needs DATABASE_URL; without
 * it, step 2 is skipped with a note. Honours MEDIA_DIR.
 */

import { readdir, readFile } from "node:fs/promises";
import path from "node:path";

import { list, put } from "@vercel/blob";
import "dotenv/config";

import { createSql } from "../src/lib/server/sql";

const dryRun = process.argv.includes("--dry-run");
const LOCAL_URL_PREFIX = "/media/";

if (!process.env.BLOB_READ_WRITE_TOKEN) {
  console.error("BLOB_READ_WRITE_TOKEN is not set — put it in .env.local (from your Vercel Blob store).");
  process.exit(1);
}

const baseDir = process.env.MEDIA_DIR?.trim() || path.join(process.cwd(), "public", "media");

/** pathname → public Blob URL for everything currently in the store. */
async function blobIndex(): Promise<Map<string, string>> {
  const index = new Map<string, string>();
  let cursor: string | undefined;
  do {
    const page = await list({ cursor, limit: 1000 });
    for (const blob of page.blobs) index.set(blob.pathname, blob.url);
    cursor = page.hasMore ? page.cursor : undefined;
  } while (cursor);
  return index;
}

/** Every file under baseDir, as store-style forward-slash pathnames. */
async function localPathnames(): Promise<string[]> {
  const entries = await readdir(baseDir, { recursive: true, withFileTypes: true }).catch(() => []);
  const names: string[] = [];
  for (const entry of entries) {
    if (!entry.isFile()) continue;
    const abs = path.join(entry.parentPath, entry.name);
    names.push(path.relative(baseDir, abs).split(path.sep).join("/"));
  }
  return names;
}

async function main(): Promise<void> {
  const blob = await blobIndex();
  const files = await localPathnames();

  // 1. Upload local-only files.
  let uploaded = 0;
  let bytes = 0;
  for (const pathname of files) {
    if (blob.has(pathname)) continue;
    const body = await readFile(path.join(baseDir, pathname));
    bytes += body.length;
    if (dryRun) {
      console.log(`  would upload: ${pathname} (${body.length} B)`);
    } else {
      const result = await put(pathname, body, {
        access: "public",
        addRandomSuffix: false,
        allowOverwrite: true,
      });
      blob.set(pathname, result.url);
    }
    uploaded += 1;
  }

  // 2. Relink rows still pointing at local /media/... paths to their Blob URL.
  let relinked = 0;
  if (process.env.DATABASE_URL) {
    const sql = createSql();
    // Row shape is fixed by the SELECT; name it so the fields read as strings.
    const rows = (await sql`
      select id, image_url from messages where image_url like ${LOCAL_URL_PREFIX + "%"}
    `) as Array<{ id: string; image_url: string }>;
    for (const row of rows) {
      const pathname = row.image_url.slice(LOCAL_URL_PREFIX.length);
      const url = blob.get(pathname);
      if (!url) continue; // not in Blob yet (upload failed / dry run) — leave it local
      if (dryRun) {
        console.log(`  would relink ${row.id}: ${row.image_url} -> ${url}`);
      } else {
        await sql`update messages set image_url = ${url} where id = ${row.id}`;
      }
      relinked += 1;
    }
  } else {
    console.log("  (DATABASE_URL unset — skipping row relink.)");
  }

  const mb = (bytes / (1024 * 1024)).toFixed(1);
  const tag = dryRun ? "[dry-run] would have" : "";
  console.log(`\nSync ${dryRun ? "preview" : "complete"} against ${baseDir}`);
  console.log(`  ${tag} uploaded ${uploaded} file(s) (${mb} MB), relinked ${relinked} row(s).`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
