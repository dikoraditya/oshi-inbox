import { NextResponse } from "next/server";

import { completeOAuth, registerWatch } from "@/lib/server/gmail";

/**
 * Google's OAuth redirect target.
 *
 * Exempt from the passphrase gate — it carries a one-time code rather than a
 * session, and Google will not send a cookie.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const denied = url.searchParams.get("error");

  const back = (params: Record<string, string>) => {
    const target = new URL("/setup", url.origin);
    for (const [key, value] of Object.entries(params)) target.searchParams.set(key, value);
    return NextResponse.redirect(target);
  };

  if (denied) return back({ error: `Google returned: ${denied}` });
  if (!code) return back({ error: "No authorisation code in the callback." });

  try {
    await completeOAuth(code);
  } catch (error) {
    return back({ error: error instanceof Error ? error.message : "OAuth exchange failed." });
  }

  // Register the push watch immediately — otherwise nothing arrives until the
  // daily cron happens to run.
  try {
    await registerWatch();
    return back({ connected: "1" });
  } catch (error) {
    return back({
      connected: "1",
      error: error instanceof Error ? error.message : "Connected, but the watch failed.",
    });
  }
}
