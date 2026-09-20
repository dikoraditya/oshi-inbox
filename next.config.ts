import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Emit a self-contained server bundle (.next/standalone) so the Docker image
  // ships only traced deps + `node server.js` — no full node_modules, no `next
  // start`. Required for the SumoPod container deploy.
  output: "standalone",
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
