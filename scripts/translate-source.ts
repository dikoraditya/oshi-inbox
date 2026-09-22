/**
 * Bulk-translate the pending backlog for one source, newest first.
 *
 *   npx tsx --env-file=.env.local scripts/translate-source.ts "≒JOY LINK"
 *
 * Runs a small pool of concurrent translations (TRANSLATE_CONCURRENCY, default 4)
 * and stops early if Anthropic credit runs out (runTranslation returns "paused"),
 * leaving the rest pending to retry later. Media-only rows (no jp) are skipped by
 * the query, so this only spends tokens on messages that actually have text.
 */
import "dotenv/config";

import { runTranslation } from "../src/lib/server/pipeline";
import { createSql } from "../src/lib/server/sql";

const source = process.argv[2];
if (!source) {
  console.error('usage: translate-source "<source>"   e.g. "≒JOY LINK"');
  process.exit(1);
}

const CONCURRENCY = Number(process.env.TRANSLATE_CONCURRENCY || "4");
const sql = createSql();

async function main(): Promise<void> {
  const rows = (await sql.query(
    `select id from messages
     where source = $1 and status = 'pending' and length(trim(jp)) > 0
     order by created_at desc`,
    [source],
  )) as Array<{ id: string }>;

  console.log(`${rows.length} pending to translate for "${source}" (concurrency ${CONCURRENCY})`);

  let done = 0;
  let failed = 0;
  let paused = false;
  let next = 0;

  async function worker(): Promise<void> {
    while (!paused) {
      const index = next;
      next += 1;
      if (index >= rows.length) return;
      const outcome = await runTranslation(rows[index].id);
      if (outcome === "paused") {
        paused = true;
        return;
      }
      if (outcome === "failed") failed += 1;
      else done += 1;
      if ((done + failed) % 50 === 0) {
        console.log(`  ${done} done, ${failed} failed, ${rows.length - done - failed} left`);
      }
    }
  }

  await Promise.all(Array.from({ length: CONCURRENCY }, worker));
  console.log(`finished: ${done} translated, ${failed} failed${paused ? " — PAUSED (out of Anthropic credit)" : ""}`);
  process.exit(0);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
