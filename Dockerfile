# syntax=docker/dockerfile:1

# Multi-stage build for the Next.js 16 app, deployed as a single container on
# SumoPod. Produces a lean image from Next's standalone output.

# ── deps: install with a clean, reproducible tree ────────────────────────────
FROM node:22-slim AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

# ── builder: compile the app + emit .next/standalone ─────────────────────────
FROM node:22-slim AS builder
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npm run build

# ── runner: minimal runtime image ───────────────────────────────────────────
FROM node:22-slim AS runner
WORKDIR /app
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    PORT=3000 \
    HOSTNAME=0.0.0.0

# Run as a non-root user.
RUN groupadd --system --gid 1001 nodejs \
 && useradd  --system --uid 1001 --gid nodejs nextjs

# Standalone server bundle + the assets it does NOT trace (static chunks, public).
COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static     ./.next/static
COPY --from=builder /app/public           ./public

# In-container replacement for Vercel Cron (drain + renew-watch).
COPY docker/scheduler.mjs ./scheduler.mjs
COPY docker/entrypoint.sh ./entrypoint.sh

# public/media is where MEDIA_STORAGE=local writes; mount a volume here to persist
# it across redeploys. Owned by the runtime user so writes succeed.
RUN chmod +x ./entrypoint.sh \
 && mkdir -p ./public/media \
 && chown -R nextjs:nodejs ./public/media

USER nextjs
EXPOSE 3000
ENTRYPOINT ["./entrypoint.sh"]
