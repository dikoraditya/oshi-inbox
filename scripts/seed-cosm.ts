/**
 * Pre-maps the COSM LINK roster (=LOVE / ≠ME / ≒JOY) into the database.
 *
 *   npm run db:seed-cosm
 *
 * For every talk room the platform defines, this creates (or updates) a member
 * already carrying the attribution key `cosm:<roomId>`. Because the collector
 * tags each COSM message with that same key, ingested messages route straight
 * to the right member — no "file it once in Unassigned" step.
 *
 * Idempotent: re-running refreshes name/group/source/attribution for each
 * `cosm-<roomId>` member without touching unread counts or timestamps.
 *
 * The room→member table below mirrors COSM_GROUPS in
 * collector/src/adapters/cosm.ts — keep the two in sync if a roster changes.
 */

import "dotenv/config";

import { createSql } from "../src/lib/server/sql";

const url = process.env.DATABASE_URL;
if (!url) {
  console.error("DATABASE_URL is not set. Put it in .env.local, or run `vercel env pull`.");
  process.exit(1);
}
const sql = createSql();

interface CosmGroupSeed {
  group: string;
  source: string;
  rooms: Record<number, string>;
}

const GROUPS: CosmGroupSeed[] = [
  {
    group: "=LOVE",
    source: "=LOVE LINK",
    rooms: {
      1: "大谷映美里", 2: "大場花菜", 3: "音嶋莉沙", 4: "齋藤樹愛羅", 5: "佐々木舞香",
      6: "髙松瞳", 7: "瀧脇笙古", 8: "野口衣織", 9: "諸橋沙夏", 10: "山本杏奈",
    },
  },
  {
    group: "≠ME",
    source: "≠ME LINK",
    rooms: {
      34: "尾木波菜", 35: "落合希来里", 36: "蟹沢萌子", 37: "河口夏音", 38: "川中子奈月心",
      39: "櫻井もも", 40: "鈴木瞳美", 41: "谷崎早耶", 42: "冨田菜々風", 43: "永田詩央里",
      44: "本田珠由記",
    },
  },
  {
    group: "≒JOY",
    source: "≒JOY LINK",
    rooms: {
      45: "Aida Jurii", 46: "Amano Konoa", 47: "Ichihara Ayumi", 48: "Esumi Reon", 49: "Oshida Mizuki",
      50: "Onishi Aoi", 51: "Ozawa Manami", 52: "Takahashi Mai", 53: "Fujisawa Riko", 54: "Murayama Yuka",
      55: "Yamada Kyoka", 56: "Yamano Arutsuki",
    },
  },
];

async function main(): Promise<void> {
  // Ensure each group exists, appended after whatever groups are already there.
  const base = (await sql`select coalesce(max(sort_order) + 1, 0) as n from groups`) as Array<{ n: number }>;
  let groupOrder = Number(base[0].n);
  for (const g of GROUPS) {
    await sql`
      insert into groups (name, sort_order) values (${g.group}, ${groupOrder})
      on conflict (name) do nothing
    `;
    groupOrder += 1;
  }

  const memberBase = (await sql`select coalesce(max(sort_order) + 1, 0) as n from members`) as Array<{ n: number }>;
  let order = Number(memberBase[0].n);
  let count = 0;
  for (const g of GROUPS) {
    for (const [roomIdRaw, name] of Object.entries(g.rooms)) {
      const roomId = Number(roomIdRaw);
      const id = `cosm-${roomId}`;
      const key = `cosm:${roomId}`;
      await sql`
        insert into members (id, name, "group", source, unread, time, sort_order, attribution_keys)
        values (${id}, ${name}, ${g.group}, ${g.source}, 0, 'new', ${order}, ${[key]})
        on conflict (id) do update set
          name             = excluded.name,
          "group"          = excluded."group",
          source           = excluded.source,
          attribution_keys = excluded.attribution_keys
      `;
      order += 1;
      count += 1;
    }
  }

  console.log(`Pre-mapped ${count} COSM members across ${GROUPS.length} groups.`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
