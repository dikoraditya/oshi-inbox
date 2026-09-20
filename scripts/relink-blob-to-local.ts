/**
 * Repoint media URLs from Vercel Blob to the local on-disk store — the DB half
 * of a permanent move OFF Blob.
 *
 *   npm run media:relink-local              # rewrite rows, for real
 *   npm run media:relink-local -- --dry-run # show what would change
 *
 * Pairs with `media:mirror-local`, which first downloads every Blob object to
 * public/media/<pathname>. This step then rewrites each row whose media URL is a
 * Blob URL (…blob.vercel-storage.com/<pathname>) to the matching local path
 * (/media/<pathname>) — exactly where mirror-local wrote the file. Idempotent:
 * rows already on /media/… are left untouched.
 *
 * Covers messages.image_url and members.avatar_url. Needs DATABASE_URL (point it
 * at the target DB — run this AFTER restoring into the self-hosted Postgres).
 */

import "dotenv/config";

import { createSql, type Sql } from "../src/lib/server/sql";

const dryRun = process.argv.includes("--dry-run");
const BLOB_HOST = ".blob.vercel-storage.com";

async function relink(sql: Sql, table: string, column: string): Promise<void> {
  const rows = (await sql.query(
    `select id, ${column} as url from ${table} where ${column} like $1`,
    [`%${BLOB_HOST}%`],
  )) as Array<{ id: string; url: string }>;

  let changed = 0;
  for (const row of rows) {
    // The LIKE filter guarantees a Blob URL; its path is the same relative key
    // mirror-local wrote to public/media, so /media + path is the local URL.
    let next: string;
    try {
      next = `/media${new URL(row.url).pathname}`;
    } catch {
      continue;
    }
    if (next === row.url) continue;
    if (dryRun) {
      console.log(`  ${table}.${column} ${row.id}: ${row.url} -> ${next}`);
    } else {
      await sql.query(`update ${table} set ${column} = $1 where id = $2`, [next, row.id]);
    }
    changed += 1;
  }
  console.log(`${table}.${column}: ${changed} ${dryRun ? "would be " : ""}relinked (${rows.length} on Blob).`);
}

async function main(): Promise<void> {
  if (!process.env.DATABASE_URL) {
    console.error("DATABASE_URL is not set.");
    process.exit(1);
  }
  const sql = createSql();
  await relink(sql, "messages", "image_url");
  await relink(sql, "members", "avatar_url");
  if (dryRun) console.log("\nDry run — no rows changed. Re-run without --dry-run to apply.");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
