import { put } from "@vercel/blob";
import { NextResponse } from "next/server";

/**
 * Stores a captured screenshot in Vercel Blob and returns its URL.
 *
 * Images do not go in Postgres — the row would balloon and every thread read
 * would pay for bytes it never renders.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Vercel Blob handles far larger, but a phone screenshot has no business exceeding this. */
const MAX_BYTES = 8 * 1024 * 1024;

export async function POST(request: Request) {
  if (!process.env.BLOB_READ_WRITE_TOKEN) {
    return NextResponse.json(
      { error: "BLOB_READ_WRITE_TOKEN is not set — connect a Blob store in Vercel." },
      { status: 500 },
    );
  }

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
    const blob = await put(`capture/${crypto.randomUUID()}.${extension}`, file, {
      access: "public",
      contentType: file.type,
    });
    return NextResponse.json({ url: blob.url });
  } catch (error) {
    console.error("[upload] failed", error);
    return NextResponse.json({ error: "Upload failed." }, { status: 500 });
  }
}
