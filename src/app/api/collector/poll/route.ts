import { NextResponse } from "next/server";

import { readState, writeState } from "@/lib/server/db";

/**
 * The local collector polls this to claim queued browser-source fetches. Like
 * /api/ingest it's called by a machine with no session cookie, so it's exempt
 * from the passphrase gate and authenticates with INGEST_SECRET instead.
 *
 * A claim is destructive: it returns the queued sources and clears them, so each
 * request is processed once.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const QUEUE_KEY = "collector-queue";

function authorize(request: Request): string | null {
  const secret = process.env.INGEST_SECRET;
  if (!secret) return "Collector endpoint is not configured — set INGEST_SECRET.";
  const header = request.headers.get("authorization") || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : header;
  // Length-invariant compare, matching the ingest endpoint's discipline.
  if (token.length !== secret.length) return "Not authorised.";
  let diff = 0;
  for (let i = 0; i < token.length; i += 1) diff |= token.charCodeAt(i) ^ secret.charCodeAt(i);
  return diff === 0 ? null : "Not authorised.";
}

export async function GET(request: Request) {
  const rejection = authorize(request);
  if (rejection) {
    const configured = Boolean(process.env.INGEST_SECRET);
    return NextResponse.json({ error: rejection }, { status: configured ? 401 : 500 });
  }

  const sources = (await readState<string[]>(QUEUE_KEY)) ?? [];
  if (sources.length) await writeState(QUEUE_KEY, []);
  return NextResponse.json({ sources });
}
