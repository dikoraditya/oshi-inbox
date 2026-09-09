import { after, NextResponse } from "next/server";

import { IngestBatchSchema } from "@/lib/ingest";
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

/**
 * Fails closed: with INGEST_SECRET unset the endpoint refuses everything rather
 * than accepting anonymous writes.
 */
function authorize(request: Request): string | null {
  const secret = process.env.INGEST_SECRET;
  if (!secret) return "Ingest endpoint is not configured — set INGEST_SECRET.";
  const header = request.headers.get("authorization") || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : header;
  // Length-invariant compare, matching the auth module's discipline.
  if (token.length !== secret.length) return "Not authorised.";
  let diff = 0;
  for (let i = 0; i < token.length; i += 1) diff |= token.charCodeAt(i) ^ secret.charCodeAt(i);
  return diff === 0 ? null : "Not authorised.";
}

export async function POST(request: Request) {
  const rejection = authorize(request);
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
