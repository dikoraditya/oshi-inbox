import { NextResponse } from "next/server";

import { listPending } from "@/lib/server/db";
import { ingestSince } from "@/lib/server/gmail";
import { eagerTranslate, runTranslation } from "@/lib/server/pipeline";

/**
 * Safety net.
 *
 * Two things can silently leave work undone: a Pub/Sub notification that never
 * arrived (or was dropped), and a translation whose `after()` callback died with
 * its invocation. This sweeps up both — it re-syncs from the Gmail cursor and
 * translates anything still pending.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** Bounded so one run can't exceed the function's time budget. */
const BATCH = 5;

function authorised(request: Request): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return process.env.NODE_ENV !== "production";
  return request.headers.get("authorization") === `Bearer ${secret}`;
}

export async function GET(request: Request) {
  if (!authorised(request)) {
    return NextResponse.json({ error: "Not authorised." }, { status: 401 });
  }

  let ingested = 0;
  let ingestError: string | null = null;

  try {
    const result = await ingestSince();
    ingested = result.inserted.length;
  } catch (error) {
    // Not fatal — translating the existing backlog is still worth doing.
    ingestError = error instanceof Error ? error.message : "Ingestion failed.";
  }

  const pending = eagerTranslate() ? await listPending(BATCH) : [];
  let translated = 0;
  let paused = false;
  for (const message of pending) {
    const outcome = await runTranslation(message.id);
    if (outcome === "paused") {
      // Out of Anthropic credit — stop hammering the API and leave the rest
      // pending. They translate on the next run once credit is topped up.
      paused = true;
      break;
    }
    translated += 1;
  }

  return NextResponse.json({
    ok: true,
    ingested,
    translated,
    paused,
    // Reported rather than thrown, so a disconnected Gmail doesn't look like
    // a broken cron.
    ingestError,
    remaining: Math.max(0, (await listPending(BATCH + 1)).length),
  });
}
