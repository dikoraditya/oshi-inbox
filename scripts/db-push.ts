/**
 * Applies db/schema.sql, then seeds members and messages if the tables are empty.
 *
 *   npm run db:push
 *
 * Safe to re-run: every schema statement is IF NOT EXISTS, and seeding is
 * skipped once any member row exists.
 */

import { readFileSync } from "node:fs";
import { neon } from "@neondatabase/serverless";
import "dotenv/config";

import { buildSeedMessages, MEMBERS } from "../src/lib/seed";
import { GROUP_ORDER } from "../src/lib/types";

const url = process.env.DATABASE_URL;
if (!url) {
  console.error("DATABASE_URL is not set. Put it in .env.local, or run `vercel env pull`.");
  process.exit(1);
}

const sql = neon(url);
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

  const rows = (await sql`select count(*)::int as count from members`) as Array<{ count: number }>;
  if (rows[0].count > 0) {
    console.log(`Members already present (${rows[0].count}) — skipping seed.`);
    return;
  }

  for (const [index, member] of MEMBERS.entries()) {
    await sql`
      insert into members (id, name, "group", source, unread, time, sort_order)
      values (${member.id}, ${member.name}, ${member.group}, ${member.source},
              ${member.unread}, ${member.time}, ${index})
      on conflict (id) do nothing
    `;
  }

  const messages = buildSeedMessages();
  for (const message of messages) {
    await sql`
      insert into messages (id, member_id, jp, romaji, en, words, time, source,
                            image_url, long, status, created_at)
      values (${message.id}, ${message.memberId}, ${message.jp}, ${message.romaji},
              ${message.en}, ${JSON.stringify(message.words)}, ${message.time},
              ${message.source}, ${null}, ${message.long}, 'done', ${message.createdAt})
      on conflict (id) do nothing
    `;
  }

  console.log(`Seeded ${MEMBERS.length} members and ${messages.length} messages.`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
