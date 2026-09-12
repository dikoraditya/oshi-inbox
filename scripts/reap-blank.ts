/**
 * Delete collector rows that are truly blank — no text AND no stored media — so a
 * fresh collect re-ingests them, this time saving the media (local/both).
 *
 *   npm run media:reap-blank                 # dry run: just counts
 *   npm run media:reap-blank -- --apply      # actually delete
 *   npm run media:reap-blank -- --source weverse --apply
 *
 * A blank row is `image_url IS NULL AND btrim(jp) = ''` — a media-only message
 * whose media failed to store (e.g. hit the old Blob cap). Text-only messages
 * (jp present) are never touched. Defaults to ingest_source = 'nogizaka'.
 *
 * After deleting, re-run the collector for that source; it re-reads history and
 * re-ingests the now-missing rows with their media.
 */

import "dotenv/config";
import { config } from "dotenv";

import { createSql } from "../src/lib/server/sql";

// The app keeps secrets in .env.local; load it too (without clobbering real env).
config({ path: ".env.local" });

const apply = process.argv.includes("--apply");
const sourceArgIndex = process.argv.indexOf("--source");
const source = sourceArgIndex >= 0 ? process.argv[sourceArgIndex + 1] : "nogizaka";

if (!process.env.DATABASE_URL) {
  console.error("DATABASE_URL is not set — put it in .env.local.");
  process.exit(1);
}

async function main(): Promise<void> {
  const sql = createSql();

  const counts = (await sql`
    select
      count(*) filter (where image_url is null and coalesce(btrim(jp), '') = '')::int as blank,
      count(*)::int as total
    from messages
    where ingest_source = ${source}
  `) as Array<{ blank: number; total: number }>;
  const { blank, total } = counts[0];

  console.log(`Source '${source}': ${total} rows, ${blank} blank (no text + no media).`);

  if (!apply) {
    console.log("Dry run — pass --apply to delete them.");
    return;
  }

  const deleted = (await sql`
    delete from messages
    where ingest_source = ${source}
      and image_url is null
      and coalesce(btrim(jp), '') = ''
    returning id
  `) as Array<{ id: string }>;
  console.log(`Deleted ${deleted.length} blank '${source}' rows. Re-collect ${source} to refill them with media.`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
