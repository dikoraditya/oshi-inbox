import { after, NextResponse } from "next/server";

import {
  assignMessage,
  clearUnread,
  deleteMessage,
  learnSenderAddress,
} from "@/lib/server/db";
import { runTranslation } from "@/lib/server/pipeline";

/**
 * PATCH  — assign an unassigned mail to a member, or re-run its translation.
 * DELETE — remove a message.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function PATCH(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const body = (await request.json().catch(() => null)) as
    | { memberId?: string; retranslate?: boolean; markRead?: boolean }
    | null;

  if (!body) {
    return NextResponse.json({ error: "Request body must be JSON." }, { status: 400 });
  }

  try {
    if (body.memberId) {
      const assigned = await assignMessage(id, body.memberId);
      if (!assigned) {
        return NextResponse.json({ error: "No such message." }, { status: 404 });
      }
      // Remember the sender so the next mail from this address routes itself.
      if (assigned.fromEmail) {
        await learnSenderAddress(body.memberId, assigned.fromEmail);
      }
      return NextResponse.json({ message: assigned });
    }

    if (body.retranslate) {
      after(() => runTranslation(id));
      return NextResponse.json({ ok: true });
    }

    if (body.markRead) {
      await clearUnread(id);
      return NextResponse.json({ ok: true });
    }

    return NextResponse.json({ error: "Nothing to do." }, { status: 400 });
  } catch (error) {
    console.error("[messages] patch failed", error);
    return NextResponse.json({ error: "Could not update the message." }, { status: 500 });
  }
}

export async function DELETE(_request: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  try {
    await deleteMessage(id);
    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("[messages] delete failed", error);
    return NextResponse.json({ error: "Could not delete the message." }, { status: 500 });
  }
}
