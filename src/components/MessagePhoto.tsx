"use client";

import { PLACEHOLDER_IMAGE, type MediaType } from "@/lib/types";

/**
 * A message's attached media.
 *
 * Media lives in Vercel Blob, so this is a plain <img>/<video> against a public
 * URL — no object URLs to create or revoke. Seed messages carry the
 * PLACEHOLDER_IMAGE sentinel and render the design's grey block instead.
 */
export function MessagePhoto({
  url,
  source,
  mediaType = "image",
}: {
  url: string;
  source: string;
  mediaType?: MediaType;
}) {
  if (url === PLACEHOLDER_IMAGE) {
    const label = mediaType === "video" ? "Video" : mediaType === "audio" ? "Audio" : "Photo";
    return (
      <div className="msg-photo">
        <span>
          {label} · {source}
        </span>
      </div>
    );
  }

  if (mediaType === "video") {
    return (
      <div className="msg-photo">
        <video src={url} controls preload="metadata" playsInline />
      </div>
    );
  }

  if (mediaType === "audio") {
    return (
      <div className="msg-photo msg-photo--audio">
        <audio src={url} controls preload="metadata" />
      </div>
    );
  }

  // Local media routes through /media/[...], which resizes + re-encodes images;
  // ask for the display width. External URLs (Blob/CDN avatars) pass through.
  const src = url.startsWith("/media/") ? `${url}?w=1280` : url;
  return (
    <div className="msg-photo">
      {/* eslint-disable-next-line @next/next/no-img-element -- arbitrary Blob host */}
      <img src={src} alt={`Screenshot from ${source}`} loading="lazy" />
    </div>
  );
}
