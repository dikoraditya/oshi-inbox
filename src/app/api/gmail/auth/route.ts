import { NextResponse } from "next/server";

import { consentUrl } from "@/lib/server/gmail";

/** Kicks off Google's consent flow. */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    return NextResponse.redirect(consentUrl());
  } catch (error) {
    const reason = error instanceof Error ? error.message : "Could not start OAuth.";
    return NextResponse.json({ error: reason }, { status: 500 });
  }
}
