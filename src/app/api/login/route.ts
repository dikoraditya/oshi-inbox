import { NextResponse } from "next/server";

import { issueSession, SESSION_COOKIE, sessionCookieOptions } from "@/lib/auth";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const secret = process.env.APP_PASSWORD;
  if (!secret) {
    return NextResponse.json({ error: "No passphrase is configured." }, { status: 400 });
  }

  const body = (await request.json().catch(() => null)) as { password?: string } | null;

  if (body?.password !== secret) {
    // Deliberately vague, and slow enough to make guessing tedious.
    await new Promise((resolve) => setTimeout(resolve, 400));
    return NextResponse.json({ error: "Wrong passphrase." }, { status: 401 });
  }

  const response = NextResponse.json({ ok: true });
  response.cookies.set(SESSION_COOKIE, await issueSession(secret), sessionCookieOptions());
  return response;
}
