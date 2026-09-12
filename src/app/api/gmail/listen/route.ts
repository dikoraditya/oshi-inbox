import { NextResponse } from "next/server";

import { resolveOrCreateMemberByEmail } from "@/lib/server/db";
import { SOURCES, type Source } from "@/lib/types";

/**
 * Register a sender to listen to, without touching Gmail labels or filters.
 *
 * POST { email, name?, group?, source? }
 *   → finds the member that already owns the address, or the roster member with
 *     that name (learning the address for them), or creates a new member.
 *
 * The union of every member's learned addresses is the sender allow-list the
 * label-free Gmail sync (see gmail.ts `ingestListenedSenders`) pulls against, so
 * registering here is all it takes to start receiving that person's mail.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  let body: { email?: string; name?: string; group?: string; source?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Request body must be JSON." }, { status: 400 });
  }

  const email = typeof body.email === "string" ? body.email.trim() : "";
  if (!email || !email.includes("@")) {
    return NextResponse.json({ error: "A valid email address is required." }, { status: 400 });
  }

  const source =
    body.source && SOURCES.includes(body.source as Source) ? (body.source as Source) : undefined;

  try {
    const { member, created } = await resolveOrCreateMemberByEmail({
      email,
      name: body.name,
      group: body.group,
      source,
    });
    return NextResponse.json({ member, created });
  } catch (error) {
    console.error("[gmail/listen] failed", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Could not register that sender." },
      { status: 500 },
    );
  }
}
