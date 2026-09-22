import { after, NextResponse } from "next/server";

import type { NormalizedMessage } from "@/lib/ingest";
import { allRoomIds, collectRooms, isConfigured as cosmConfigured } from "@/lib/server/cosm";
import { collectCircles, isConfigured as bstageConfigured } from "@/lib/server/bstage";
import { ingestBatch } from "@/lib/server/ingest";
import { eagerTranslate, runTranslation } from "@/lib/server/pipeline";

/**
 * On-demand fetch for the pure-REST sources (behind the app's passphrase gate).
 *
 * COSM (=LOVE/≠ME/≒JOY) and b.stage (NMB48 POP) run server-side (no browser).
 *   { key: "cosm:46" }         → that COSM room
 *   { key: "bstage:<circle>" }  → that b.stage member's latest POP message
 *   {}                          → every configured source (Fetch all)
 *
 * Sources are collected independently: one source erroring (e.g. an upstream
 * WAF 403) never blocks the others — its error is reported alongside whatever
 * did come through. Browser sources (Weverse/Nogizaka) live in the collector.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function POST(request: Request) {
  const body = (await request.json().catch(() => ({}))) as { key?: string };
  const key = typeof body.key === "string" ? body.key : null;

  const messages: NormalizedMessage[] = [];
  const errors: string[] = [];

  async function collectCosmRooms(roomIds: number[]): Promise<void> {
    try {
      messages.push(...(await collectRooms(roomIds)));
    } catch (error) {
      errors.push(`cosm: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  async function collectBstage(circleIds?: string[]): Promise<void> {
    try {
      messages.push(...(await collectCircles(circleIds)));
    } catch (error) {
      errors.push(`bstage: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  if (key?.startsWith("cosm:")) {
    const roomId = Number(key.slice("cosm:".length));
    if (Number.isInteger(roomId)) await collectCosmRooms([roomId]);
  } else if (key?.startsWith("bstage:")) {
    await collectBstage([key.slice("bstage:".length)]);
  } else if (!key) {
    if (cosmConfigured()) await collectCosmRooms(allRoomIds());
    if (bstageConfigured()) await collectBstage();
  }

  // Only hard-fail when nothing came through at all and something errored.
  if (!messages.length && errors.length) {
    return NextResponse.json({ error: errors.join("; ") }, { status: 502 });
  }

  const { inserted, repaired, scanned } = await ingestBatch(messages);
  if (eagerTranslate()) {
    after(async () => {
      for (const message of inserted) {
        await runTranslation(message.id);
      }
    });
  }

  return NextResponse.json({
    ok: true,
    scanned,
    inserted: inserted.length,
    repaired,
    ...(errors.length ? { errors } : {}),
  });
}
