import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Oshi Inbox",
    short_name: "Oshi Inbox",
    description:
      "One inbox for every group — Japanese, romaji and English, aligned line for line.",
    start_url: "/",
    display: "standalone",
    orientation: "portrait",
    background_color: "#f3f2f2",
    theme_color: "#f3f2f2",
    icons: [
      { src: "/icons/192", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icons/512", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icons/512", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
