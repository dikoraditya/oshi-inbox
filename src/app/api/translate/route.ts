import { after, NextResponse } from "next/server";

import { listPendingForMember } from "@/lib/server/db";
import { runTranslation } from "@/lib/server/pipeline";

/**
 * Translate-on-read: called when a thread opens, so we only spend on messages
 * actually looked at (ingest stores them pending; see EAGER_TRANSLATE). Bounded
 * per open — the newest window covers what's on screen; re-opening and the
 * client's poll pick up the rest. Runs in after() so the thread opens instantly.
 * Session-gated by middleware.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_PER_OPEN = 50;

export async function POST(request: Request) {
  const body = (await request.json().catch(() => null)) as { memberId?: string } | null;
  if (!body?.memberId) {
    return NextResponse.json({ error: "memberId is required." }, { status: 400 });
  }

  const pending = await listPendingForMember(body.memberId, MAX_PER_OPEN);
  after(async () => {
    for (const message of pending) {
      const outcome = await runTranslation(message.id);
      if (outcome === "paused") break; // out of credit — stop, leave the rest pending
    }
  });

  return NextResponse.json({ ok: true, queued: pending.length });
}
