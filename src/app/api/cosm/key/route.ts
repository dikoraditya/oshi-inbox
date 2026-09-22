import { NextResponse } from "next/server";

import { readState, writeState } from "@/lib/server/db";

/**
 * The COSM LINK verification key (x-request-verification-key) rotates, so it
 * lives in app_state rather than an env var — settable from Setup without a
 * redeploy. cosm.ts reads this first and falls back to COSM_REQUEST_VERIFICATION_KEY.
 * Session-gated (a logged-in user pastes it in).
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const KEY = "cosm:rvk";

export async function GET() {
  const stored = (await readState<string>(KEY))?.trim();
  const source = stored ? "db" : process.env.COSM_REQUEST_VERIFICATION_KEY?.trim() ? "env" : null;
  return NextResponse.json({ set: Boolean(source), source });
}

export async function POST(request: Request) {
  const body = (await request.json().catch(() => null)) as { key?: string } | null;
  const key = typeof body?.key === "string" ? body.key.trim() : "";
  // An empty value clears the stored key, falling back to the env var if present.
  await writeState(KEY, key);
  const source = key ? "db" : process.env.COSM_REQUEST_VERIFICATION_KEY?.trim() ? "env" : null;
  return NextResponse.json({ ok: true, set: Boolean(source), source });
}
