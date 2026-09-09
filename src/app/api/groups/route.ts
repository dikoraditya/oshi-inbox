import { NextResponse } from "next/server";

import { insertGroup, listGroups } from "@/lib/server/db";

/** Creates a group from the Roster screen. */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Long enough for any real group name, short enough to keep the chip row sane. */
const MAX_NAME = 60;

export async function POST(request: Request) {
  const body = (await request.json().catch(() => null)) as { name?: string } | null;
  const name = body?.name?.trim();

  if (!name) {
    return NextResponse.json({ error: "A group name is required." }, { status: 400 });
  }
  if (name.length > MAX_NAME) {
    return NextResponse.json({ error: `Keep it under ${MAX_NAME} characters.` }, { status: 400 });
  }

  try {
    const created = await insertGroup(name);
    if (!created) {
      return NextResponse.json({ error: `"${name}" already exists.` }, { status: 409 });
    }
    return NextResponse.json({ groups: await listGroups() });
  } catch (error) {
    console.error("[groups] create failed", error);
    return NextResponse.json({ error: "Could not add that group." }, { status: 500 });
  }
}
