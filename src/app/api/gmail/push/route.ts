import { OAuth2Client } from "google-auth-library";
import { after, NextResponse } from "next/server";

import { ingestSince } from "@/lib/server/gmail";
import { eagerTranslate, runTranslation } from "@/lib/server/pipeline";

/**
 * Cloud Pub/Sub push endpoint — the thing Gmail's watch ultimately calls.
 *
 * The body carries no mail, only `{emailAddress, historyId}`. We hand that to
 * ingestSince(), which walks Gmail's history and stores whatever is new.
 *
 * Exempt from the passphrase gate (Pub/Sub holds no cookie), so it
 * authenticates itself — see verifyPush below.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
/** Ingestion fetches N messages and may translate them; give it room. */
export const maxDuration = 60;

interface PushEnvelope {
  message?: { data?: string; messageId?: string; publishTime?: string };
  subscription?: string;
}

/**
 * Authenticate the caller. Fails closed: with neither mechanism configured,
 * the endpoint refuses everything rather than accepting anonymous writes.
 */
async function verifyPush(request: Request): Promise<string | null> {
  const audience = process.env.PUBSUB_AUDIENCE;
  const sharedSecret = process.env.PUBSUB_PUSH_SECRET;

  if (audience) {
    const header = request.headers.get("authorization") ?? "";
    const token = header.startsWith("Bearer ") ? header.slice(7) : "";
    if (!token) return "Missing OIDC bearer token.";
    try {
      const client = new OAuth2Client();
      const ticket = await client.verifyIdToken({ idToken: token, audience });
      const payload = ticket.getPayload();
      if (!payload?.email_verified) return "OIDC token is not from a verified account.";
      const allowed = process.env.PUBSUB_SERVICE_ACCOUNT;
      if (allowed && payload.email !== allowed) return "Unexpected service account.";
      return null;
    } catch {
      return "OIDC verification failed.";
    }
  }

  if (sharedSecret) {
    const provided = new URL(request.url).searchParams.get("token");
    if (provided !== sharedSecret) return "Bad push token.";
    return null;
  }

  return "Push endpoint is not configured — set PUBSUB_AUDIENCE or PUBSUB_PUSH_SECRET.";
}

export async function POST(request: Request) {
  const rejection = await verifyPush(request);
  if (rejection) {
    console.warn("[gmail/push] rejected:", rejection);
    return NextResponse.json({ error: rejection }, { status: 401 });
  }

  let envelope: PushEnvelope;
  try {
    envelope = await request.json();
  } catch {
    // Malformed body will never succeed on retry — ack it so Pub/Sub stops.
    return NextResponse.json({ ok: true, ignored: "unparseable body" });
  }

  let historyId: string | undefined;
  try {
    const decoded = envelope.message?.data
      ? JSON.parse(Buffer.from(envelope.message.data, "base64").toString("utf8"))
      : null;
    historyId = decoded?.historyId ? String(decoded.historyId) : undefined;
  } catch {
    return NextResponse.json({ ok: true, ignored: "unparseable notification" });
  }

  try {
    const result = await ingestSince(historyId);

    // Translate after responding: Pub/Sub wants a fast ack, and a slow model
    // call here would push the delivery into a retry.
    if (eagerTranslate() && result.inserted.length > 0) {
      after(async () => {
        for (const message of result.inserted) {
          await runTranslation(message.id);
        }
      });
    }

    return NextResponse.json({
      ok: true,
      inserted: result.inserted.length,
      scanned: result.scanned,
      usedFallback: result.usedFallback,
    });
  } catch (error) {
    // Transient — a 500 makes Pub/Sub redeliver, and the unique constraint on
    // gmail_message_id makes that safe.
    console.error("[gmail/push] ingestion failed", error);
    return NextResponse.json({ error: "Ingestion failed." }, { status: 500 });
  }
}
