import { NextResponse } from "next/server";

import { gradeLearn, listLearn, setKnown, startLearning } from "@/lib/server/db";

/**
 * The learning layer: known-word set + a small SM-2 spaced-repetition deck.
 * Session-gated by middleware.
 *   GET  → { known: string[], due: LearnCard[] }
 *   POST → { word, reading?, gloss?, action: "known"|"study"|"grade", rating? }
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    return NextResponse.json(await listLearn());
  } catch (error) {
    console.error("[learn] list failed", error);
    return NextResponse.json({ error: "Could not read learning data." }, { status: 500 });
  }
}

export async function POST(request: Request) {
  const body = (await request.json().catch(() => null)) as {
    word?: string;
    reading?: string;
    gloss?: string;
    action?: string;
    rating?: string;
  } | null;

  const word = body?.word?.trim();
  if (!word || !body?.action) {
    return NextResponse.json({ error: "word and action are required." }, { status: 400 });
  }

  try {
    if (body.action === "known") {
      await setKnown(word, body.reading ?? "", body.gloss ?? "");
    } else if (body.action === "study") {
      await startLearning(word, body.reading ?? "", body.gloss ?? "");
    } else if (
      body.action === "grade" &&
      (body.rating === "again" || body.rating === "good" || body.rating === "easy")
    ) {
      await gradeLearn(word, body.rating);
    } else {
      return NextResponse.json({ error: "Unknown action." }, { status: 400 });
    }
    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("[learn] update failed", error);
    return NextResponse.json({ error: "Could not update learning data." }, { status: 500 });
  }
}
