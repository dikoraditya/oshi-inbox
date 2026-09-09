import { NextResponse, type NextRequest } from "next/server";

import { SESSION_COOKIE, verifySession } from "@/lib/auth";

/**
 * Gates the whole app behind APP_PASSWORD.
 *
 * Some routes are exempt because they are called by machines that cannot hold a
 * session cookie, and each authenticates itself differently:
 *
 *   /api/gmail/push     — Pub/Sub; verified by its OIDC bearer token
 *   /api/gmail/callback — Google's OAuth redirect; carries a one-time code
 *   /api/cron/*         — Vercel Cron; verified by CRON_SECRET
 *   /api/ingest         — the local collector; verified by INGEST_SECRET
 *
 * If APP_PASSWORD is unset the gate is disabled entirely, so local development
 * needs no ceremony. Vercel deployments should always set it.
 */

const EXEMPT = [
  "/api/gmail/push",
  "/api/gmail/callback",
  "/api/cron",
  "/api/ingest",
  "/api/collector/poll",
  "/api/collector/roster",
  "/login",
  "/api/login",
];

export async function middleware(request: NextRequest) {
  const secret = process.env.APP_PASSWORD;
  if (!secret) return NextResponse.next();

  const { pathname } = request.nextUrl;
  if (EXEMPT.some((prefix) => pathname.startsWith(prefix))) return NextResponse.next();

  const token = request.cookies.get(SESSION_COOKIE)?.value;
  if (await verifySession(token, secret)) return NextResponse.next();

  // API callers get a status they can act on; browsers get the login page.
  if (pathname.startsWith("/api/")) {
    return NextResponse.json({ error: "Not authorised." }, { status: 401 });
  }

  const login = request.nextUrl.clone();
  login.pathname = "/login";
  login.search = "";
  return NextResponse.redirect(login);
}

export const config = {
  // Everything except Next's own assets and the generated icons.
  matcher: ["/((?!_next/static|_next/image|favicon.ico|icons/|manifest.webmanifest|sw.js).*)"],
};
