import { NextResponse } from "next/server";

import { insertMember, listGroups } from "@/lib/server/db";
import { SOURCES, type Source } from "@/lib/types";

/** Creates a member from the Roster screen. */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const body = (await request.json().catch(() => null)) as
    | { name?: string; group?: string; source?: string }
    | null;

  const name = body?.name?.trim();
  const group = body?.group?.trim();
  const source = body?.source;

  if (!name) {
    return NextResponse.json({ error: "A name is required." }, { status: 400 });
  }
  // Sources are a fixed property of the app, so an unknown one is a bug, not data.
  if (!source || !SOURCES.includes(source as Source)) {
    return NextResponse.json({ error: "Unknown source." }, { status: 400 });
  }

  try {
    const groups = await listGroups();
    if (!group || !groups.includes(group)) {
      return NextResponse.json({ error: "Unknown group." }, { status: 400 });
    }

    const member = await insertMember({
      // Readable, collision-resistant, and stable enough to appear in URLs.
      id: `m-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`,
      name,
      group,
      source: source as Source,
    });

    return NextResponse.json({ member });
  } catch (error) {
    console.error("[members] create failed", error);
    return NextResponse.json({ error: "Could not add that member." }, { status: 500 });
  }
}
