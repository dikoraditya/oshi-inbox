import { ImageResponse } from "next/og";

/**
 * App icons, rendered as real PNGs at request time.
 *
 * Generating them rather than committing binaries keeps the mark in sync with
 * the design tokens — accent red ground, ink lettering, no rounded corners.
 */

export const dynamic = "force-static";

export function generateStaticParams() {
  return [{ size: "192" }, { size: "512" }];
}

const ALLOWED = new Set([192, 512]);

export async function GET(_request: Request, ctx: { params: Promise<{ size: string }> }) {
  const { size } = await ctx.params;
  const parsed = Number(size);
  if (!ALLOWED.has(parsed)) {
    return new Response("Not found", { status: 404 });
  }

  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: "#ec3013",
          color: "#f3f2f2",
          fontSize: parsed * 0.42,
          fontWeight: 800,
          letterSpacing: `-${parsed * 0.015}px`,
          fontFamily: "sans-serif",
        }}
      >
        OI
      </div>
    ),
    { width: parsed, height: parsed },
  );
}
