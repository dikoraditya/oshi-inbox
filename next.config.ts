import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  async headers() {
    return [
      // The service worker controls the whole origin, so it must never be cached.
      {
        source: "/sw.js",
        headers: [
          { key: "Cache-Control", value: "no-cache, no-store, must-revalidate" },
          { key: "Service-Worker-Allowed", value: "/" },
        ],
      },
    ];
  },
};

export default nextConfig;
