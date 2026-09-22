import { NextResponse } from "next/server";

import { readState, writeState } from "@/lib/server/db";

/**
 * Enqueue a browser-driven source (Weverse / Nogizaka) for the local collector
 * to pick up on its next poll. Session-gated (a logged-in user clicks "Sync
 * apps") — the collector claims the queue via /api/collector/poll with a secret.
 *
 * These sources can't run on Vercel (they need a real logged-in browser), so
 * the button only *requests* a fetch; the collector does the work and posts to
 * /api/ingest, and the app's normal polling surfaces the new messages.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const QUEUE_KEY = "collector-queue";
const KNOWN = ["weverse", "nogizaka"];

export async function POST(request: Request) {
  const body = (await request.json().catch(() => null)) as { source?: string } | null;
  const raw = body?.source;
  const sources = raw === "all" ? [...KNOWN] : raw && KNOWN.includes(raw) ? [raw] : [];
  if (!sources.length) {
    return NextResponse.json({ error: "Unknown source." }, { status: 400 });
  }

  const current = (await readState<string[]>(QUEUE_KEY)) ?? [];
  const next = [...new Set([...current, ...sources])];
  await writeState(QUEUE_KEY, next);

  return NextResponse.json({ ok: true, queued: next });
}
