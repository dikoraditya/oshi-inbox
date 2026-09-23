import { NextResponse } from "next/server";

import { markKnownBulk, readState, writeState } from "@/lib/server/db";
import { fetchWaniKaniKnown } from "@/lib/server/wanikani";

/**
 * Sync WaniKani progress → the app's known-word set. POST a token to save it
 * (app_state) and sync; POST with no body to re-sync using the saved token.
 * Session-gated. Runs long (paginated fetch) so hit it on the box, not the tunnel.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

const KEY = "wanikani:token";

export async function GET() {
  const token = (await readState<string>(KEY))?.trim();
  return NextResponse.json({ configured: Boolean(token) });
}

export async function POST(request: Request) {
  const body = (await request.json().catch(() => null)) as { token?: string } | null;
  const incoming = body?.token?.trim();
  if (incoming) await writeState(KEY, incoming);
  const token = incoming || (await readState<string>(KEY))?.trim();
  if (!token) {
    return NextResponse.json({ error: "No WaniKani token set." }, { status: 400 });
  }

  try {
    const words = await fetchWaniKaniKnown(token);
    const known = await markKnownBulk(words);
    return NextResponse.json({ ok: true, known });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "WaniKani sync failed." },
      { status: 502 },
    );
  }
}
