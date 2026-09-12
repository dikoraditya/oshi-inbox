import { NextResponse } from "next/server";

import { storeMedia } from "@/lib/server/media";

/**
 * Stores a captured screenshot and returns its URL.
 *
 * Images do not go in Postgres — the row would balloon and every thread read
 * would pay for bytes it never renders. Where they land (Vercel Blob or local
 * disk) is decided by the media backend, so this works with no cloud config.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Vercel Blob handles far larger, but a phone screenshot has no business exceeding this. */
const MAX_BYTES = 8 * 1024 * 1024;

export async function POST(request: Request) {
  const form = await request.formData().catch(() => null);
  const file = form?.get("file");

  if (!(file instanceof File)) {
    return NextResponse.json({ error: "Expected a file field." }, { status: 400 });
  }
  if (!file.type.startsWith("image/")) {
    return NextResponse.json({ error: "Only images are accepted." }, { status: 415 });
  }
  if (file.size > MAX_BYTES) {
    return NextResponse.json({ error: "That image is larger than 8 MB." }, { status: 413 });
  }

  try {
    const extension = file.type.split("/")[1]?.split("+")[0] || "png";
    const url = await storeMedia(`capture/${crypto.randomUUID()}.${extension}`, file, file.type);
    return NextResponse.json({ url });
  } catch (error) {
    console.error("[upload] failed", error);
    return NextResponse.json({ error: "Upload failed." }, { status: 500 });
  }
}
