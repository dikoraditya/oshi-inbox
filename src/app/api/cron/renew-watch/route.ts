import { NextResponse } from "next/server";

import { registerWatch } from "@/lib/server/gmail";

/**
 * Daily watch renewal.
 *
 * Gmail expires a push watch after 7 days. Miss the renewal and ingestion stops
 * without any error anywhere — which is exactly the kind of failure that goes
 * unnoticed for a fortnight. Hence a daily cron rather than a weekly one.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function authorised(request: Request): boolean {
  const secret = process.env.CRON_SECRET;
  // Vercel Cron sends `Authorization: Bearer $CRON_SECRET` automatically.
  if (!secret) return process.env.NODE_ENV !== "production";
  return request.headers.get("authorization") === `Bearer ${secret}`;
}

export async function GET(request: Request) {
  if (!authorised(request)) {
    return NextResponse.json({ error: "Not authorised." }, { status: 401 });
  }

  try {
    const watch = await registerWatch();
    return NextResponse.json({ ok: true, expiresAt: new Date(watch.expiration).toISOString() });
  } catch (error) {
    const reason = error instanceof Error ? error.message : "Renewal failed.";
    console.error("[cron/renew-watch]", reason);
    return NextResponse.json({ error: reason }, { status: 500 });
  }
}
