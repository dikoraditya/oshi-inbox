/**
 * Applies db/schema.sql and ensures the base group rows exist.
 *
 *   npm run db:push
 *
 * Safe to re-run: every schema statement is IF NOT EXISTS and group inserts are
 * ON CONFLICT DO NOTHING. Real member/message data comes from the live sources
 * (collector, Gmail, in-app Fetch) — this never writes fixtures.
 */

import { readFileSync } from "node:fs";
import "dotenv/config";

import { createSql } from "../src/lib/server/sql";
import { GROUP_ORDER } from "../src/lib/types";

const url = process.env.DATABASE_URL;
if (!url) {
  console.error("DATABASE_URL is not set. Put it in .env.local, or run `vercel env pull`.");
  process.exit(1);
}

const sql = createSql();
const schema = readFileSync(new URL("../db/schema.sql", import.meta.url), "utf8");

// The HTTP driver takes one statement per round trip, so split the file rather
// than shipping it whole. Comment-only chunks are dropped.
const statements = schema
  .split(/;\s*$/m)
  .map((chunk) => chunk.trim())
  .filter((chunk) => chunk && !chunk.split("\n").every((line) => line.trim().startsWith("--")));

async function main(): Promise<void> {
  for (const statement of statements) {
    await sql.query(statement);
  }
  console.log(`Applied ${statements.length} schema statements.`);

  // Groups seed independently of members: an existing install that predates the
  // Roster screen still needs its groups backfilled.
  for (const [index, group] of GROUP_ORDER.entries()) {
    await sql`
      insert into groups (name, sort_order) values (${group}, ${index})
      on conflict (name) do nothing
    `;
  }
  console.log(`Ensured ${GROUP_ORDER.length} groups.`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
