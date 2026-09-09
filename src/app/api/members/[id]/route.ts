import { NextResponse } from "next/server";

import { learnSenderAddress, updateMember } from "@/lib/server/db";

/**
 * PATCH — edit a member's profile from the Edit Profile screen.
 *
 * Accepts any subset of { name, avatarUrl, blogUrl, email }. `email` is appended
 * to the member's learned sender addresses, so Gmail mobame from that address
 * routes straight to this member (the same mechanism assignment teaches).
 * `avatarUrl`/`blogUrl` may be null to clear them.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function PATCH(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const body = (await request.json().catch(() => null)) as
    | { name?: string; avatarUrl?: string | null; blogUrl?: string | null; email?: string }
    | null;

  if (!body) {
    return NextResponse.json({ error: "Request body must be JSON." }, { status: 400 });
  }

  try {
    // A new email is learned first, so the member we return already reflects it.
    if (body.email && body.email.trim()) {
      await learnSenderAddress(id, body.email);
    }

    const patch: { name?: string; avatarUrl?: string | null; blogUrl?: string | null } = {};
    if (body.name !== undefined) patch.name = body.name.trim();
    if (body.avatarUrl !== undefined) patch.avatarUrl = body.avatarUrl?.trim() || null;
    if (body.blogUrl !== undefined) patch.blogUrl = body.blogUrl?.trim() || null;

    const member = await updateMember(id, patch);
    if (!member) return NextResponse.json({ error: "No such member." }, { status: 404 });
    return NextResponse.json({ member });
  } catch (error) {
    console.error("[members] update failed", error);
    return NextResponse.json({ error: "Could not update the member." }, { status: 500 });
  }
}
