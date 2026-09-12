import { after, NextResponse } from "next/server";

import { IngestBatchSchema } from "@/lib/ingest";
import { authorizeCollector } from "@/lib/server/collector-auth";
import { ingestBatch } from "@/lib/server/ingest";
import { runTranslation } from "@/lib/server/pipeline";

/**
 * Ingest endpoint for the local collector.
 *
 * The collector drives your logged-in browser sessions, normalises each app's
 * messages, and posts batches here. It holds no app session cookie, so — like
 * the Gmail push endpoint — it authenticates itself with a shared secret and is
 * exempt from the passphrase gate in middleware.
 *
 * Stores everything as pending and returns immediately; translation runs in
 * after() so a large backfill doesn't hold the request open.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
/** A backfill batch fetches media for up to 500 messages — give it room. */
export const maxDuration = 60;

/** Stores everything as pending and returns immediately; translation runs in
 * after() so a large backfill doesn't hold the request open. */
export async function POST(request: Request) {
  const rejection = authorizeCollector(request);
  if (rejection) {
    const configured = Boolean(process.env.INGEST_SECRET);
    return NextResponse.json({ error: rejection }, { status: configured ? 401 : 500 });
  }

  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return NextResponse.json({ error: "Expected a JSON body." }, { status: 400 });
  }

  const parsed = IngestBatchSchema.safeParse(payload);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid batch.", issues: parsed.error.issues },
      { status: 422 },
    );
  }

  const { inserted, scanned } = await ingestBatch(parsed.data.messages);

  // Translate only the newly inserted rows, off the response path.
  after(async () => {
    for (const message of inserted) {
      await runTranslation(message.id);
    }
  });

  return NextResponse.json({ ok: true, scanned, inserted: inserted.length });
}
