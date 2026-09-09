/**
 * Pre-maps the NMB48 b.stage roster into the database.
 *
 *   npm run db:seed-bstage
 *
 * Logs into b.stage, fetches the member list (circles), and upserts one member
 * per circle already carrying the attribution key `bstage:<circleId>`, so
 * ingested POP messages route straight to the right member. Idempotent.
 *
 * Standalone (no app imports): needs DATABASE_URL + BSTAGE_EMAIL + BSTAGE_PASSWORD.
 */

import { neon } from "@neondatabase/serverless";
import "dotenv/config";

const dbUrl = process.env.DATABASE_URL;
if (!dbUrl) {
  console.error("DATABASE_URL is not set. Put it in .env.local, or run `vercel env pull`.");
  process.exit(1);
}
const email = process.env.BSTAGE_EMAIL;
const password = process.env.BSTAGE_PASSWORD;
if (!email || !password) {
  console.error("BSTAGE_EMAIL / BSTAGE_PASSWORD are not set.");
  process.exit(1);
}

const stageId = process.env.BSTAGE_STAGE_ID || "nmb48-global";
const host = `https://${stageId}.bstage.in`;
const GROUP = "NMB48";
const SOURCE = "NMB48 Talk";

const sql = neon(dbUrl);

async function main(): Promise<void> {
  const loginRes = await fetch(`${host}/svc/account/api/v1/auth/token?stageId=${stageId}`, {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json" },
    body: JSON.stringify({ email, password }),
  });
  if (!loginRes.ok) {
    console.error(`b.stage login failed: HTTP ${loginRes.status}`);
    process.exit(1);
  }
  const { accessToken } = (await loginRes.json()) as { accessToken?: string };
  if (!accessToken) {
    console.error("b.stage login returned no accessToken.");
    process.exit(1);
  }

  const circlesRes = await fetch(`${host}/svc/live-streaming/api/v2/circles`, {
    headers: { authorization: `Bearer ${accessToken}`, accept: "application/json" },
  });
  if (!circlesRes.ok) {
    console.error(`b.stage circles failed: HTTP ${circlesRes.status}`);
    process.exit(1);
  }
  const { circles = [] } = (await circlesRes.json()) as {
    circles?: Array<{ id: string; creator?: { nickname?: string; avatarImgPath?: string } }>;
  };

  await sql`
    insert into groups (name, sort_order)
    values (${GROUP}, coalesce((select max(sort_order) + 1 from groups), 0))
    on conflict (name) do nothing
  `;

  const base = (await sql`select coalesce(max(sort_order) + 1, 0) as n from members`) as Array<{ n: number }>;
  let order = Number(base[0].n);
  let count = 0;
  for (const circle of circles) {
    const id = `bstage-${circle.id}`;
    const name = circle.creator?.nickname ?? circle.id;
    const key = `bstage:${circle.id}`;
    const avatar = circle.creator?.avatarImgPath ?? null;
    await sql`
      insert into members (id, name, "group", source, unread, time, sort_order, attribution_keys, avatar_url)
      values (${id}, ${name}, ${GROUP}, ${SOURCE}, 0, 'new', ${order}, ${[key]}, ${avatar})
      on conflict (id) do update set
        name             = excluded.name,
        "group"          = excluded."group",
        source           = excluded.source,
        attribution_keys = excluded.attribution_keys,
        -- Fill from the source, but never clobber a hand-set avatar.
        avatar_url       = coalesce(members.avatar_url, excluded.avatar_url)
    `;
    order += 1;
    count += 1;
  }

  console.log(`Pre-mapped ${count} NMB48 b.stage members.`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
