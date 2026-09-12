import { after, NextResponse } from "next/server";

import { ingestListenedSenders } from "@/lib/server/gmail";
import { runTranslation } from "@/lib/server/pipeline";

/**
 * Label-free, on-demand Gmail pull.
 *
 * Reads recent mail directly from the registered senders (the union of every
 * member's learned addresses) with no Gmail label or filter involved. Register
 * a sender with POST /api/gmail/listen first; this then delivers their mail.
 *
 * Body (optional): { days?: number, max?: number }.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function POST(request: Request) {
  const body = (await request.json().catch(() => ({}))) as {
    days?: number;
    max?: number;
    from?: string;
  };

  try {
    const { inserted, scanned } = await ingestListenedSenders({
      newerThanDays: typeof body.days === "number" ? body.days : undefined,
      max: typeof body.max === "number" ? body.max : undefined,
      from: typeof body.from === "string" ? body.from : undefined,
    });

    after(async () => {
      for (const message of inserted) await runTranslation(message.id);
    });

    return NextResponse.json({ ok: true, scanned, inserted: inserted.length });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Sync failed." },
      { status: 502 },
    );
  }
}
