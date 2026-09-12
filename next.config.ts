import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // node-postgres is only loaded when DB_DRIVER selects it; keep it external so
  // Next never tries to bundle its optional native/driver requires.
  serverExternalPackages: ["pg"],
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
