import { NextResponse } from "next/server";
import { z } from "zod";

import { authorizeCollector } from "@/lib/server/collector-auth";
import { upsertRosterMembers } from "@/lib/server/db";

/**
 * Pre-create members a collector discovered (Nogizaka groups, Weverse artists),
 * each carrying its source-scoped attribution key, so their ingested messages
 * route to a named member instead of landing in Unassigned.
 *
 * Sibling of /api/ingest: same shared-secret gate, same collector caller.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const RosterSchema = z.object({
  members: z.array(
    z.object({
      id: z.string().min(1),
      name: z.string().min(1),
      group: z.string().min(1),
      source: z.string().min(1),
      key: z.string().min(1),
      avatarUrl: z.string().url().nullish(),
    }),
  ),
});

export async function POST(request: Request) {
  const rejection = authorizeCollector(request);
  if (rejection) {
    const configured = Boolean(process.env.INGEST_SECRET);
    return NextResponse.json({ error: rejection }, { status: configured ? 401 : 500 });
  }

  const payload = await request.json().catch(() => null);
  const parsed = RosterSchema.safeParse(payload);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid roster.", issues: parsed.error.issues }, { status: 422 });
  }

  const upserted = await upsertRosterMembers(parsed.data.members);
  return NextResponse.json({ ok: true, upserted });
}
