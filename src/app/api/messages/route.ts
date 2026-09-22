import { after, NextResponse } from "next/server";

import { listGroups, listMembers, listMessages, upsertMessage } from "@/lib/server/db";
import { runTranslation } from "@/lib/server/pipeline";
import type { Message } from "@/lib/types";

/**
 * GET  — the whole dataset the client mirrors into IndexedDB.
 * POST — create or overwrite one message (the capture form).
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const raw = new URL(request.url).searchParams.get("since");
    const since = raw && Number.isFinite(Number(raw)) ? Number(raw) : undefined;
    const [members, messages, groups] = await Promise.all([
      listMembers(),
      listMessages(since),
      listGroups(),
    ]);
    return NextResponse.json({ members, messages, groups });
  } catch (error) {
    console.error("[messages] load failed", error);
    return NextResponse.json({ error: "Could not read the database." }, { status: 500 });
  }
}

export async function POST(request: Request) {
  let body: Partial<Message> & { retranslate?: boolean };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Request body must be JSON." }, { status: 400 });
  }

  if (!body.id || !body.source || typeof body.jp !== "string") {
    return NextResponse.json({ error: "id, jp and source are required." }, { status: 400 });
  }

  const message: Message = {
    id: body.id,
    memberId: body.memberId ?? null,
    jp: body.jp,
    romaji: body.romaji ?? "",
    en: body.en ?? "",
    words: body.words ?? [],
    time: body.time ?? "",
    source: body.source,
    imageUrl: body.imageUrl ?? null,
    long: body.long ?? false,
    status: body.status ?? "pending",
    error: body.error ?? null,
    createdAt: body.createdAt ?? Date.now(),
    gmailMessageId: body.gmailMessageId ?? null,
    fromEmail: body.fromEmail ?? null,
    fromName: body.fromName ?? null,
  };

  try {
    const saved = await upsertMessage(message);

    // Translate after responding, so capture never waits on the model.
    if (saved.status === "pending" && saved.jp.trim()) {
      after(() => runTranslation(saved.id));
    }

    return NextResponse.json({ message: saved });
  } catch (error) {
    console.error("[messages] save failed", error);
    return NextResponse.json({ error: "Could not save the message." }, { status: 500 });
  }
}
