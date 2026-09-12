import { NextResponse } from "next/server";

import { isConnected, labelName, registerWatch, watchState } from "@/lib/server/gmail";
import { mediaBackend } from "@/lib/server/media";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Powers the /setup screen. */
export async function GET() {
  try {
    const [connected, watch] = await Promise.all([isConnected(), watchState()]);
    return NextResponse.json({
      connected,
      label: labelName(),
      watch,
      watchExpiresIn: watch ? watch.expiration - Date.now() : null,
      env: {
        googleClientId: !!process.env.GOOGLE_CLIENT_ID,
        pubsubTopic: !!process.env.GMAIL_PUBSUB_TOPIC,
        blobToken: !!process.env.BLOB_READ_WRITE_TOKEN,
        mediaStorage: mediaBackend(),
        anthropicKey: !!process.env.ANTHROPIC_API_KEY,
      },
    });
  } catch (error) {
    console.error("[gmail] status failed", error);
    return NextResponse.json({ error: "Could not read Gmail status." }, { status: 500 });
  }
}

/** Manual "renew watch" button on /setup. */
export async function POST() {
  try {
    const watch = await registerWatch();
    return NextResponse.json({ watch });
  } catch (error) {
    const reason = error instanceof Error ? error.message : "Could not register the watch.";
    return NextResponse.json({ error: reason }, { status: 500 });
  }
}
