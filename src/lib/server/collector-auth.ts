import "server-only";

/**
 * Shared Bearer-secret gate for the collector-facing endpoints (`/api/ingest`
 * and `/api/collector/roster`). The collector holds no app session cookie, so —
 * like the Gmail push endpoint — it authenticates with INGEST_SECRET and is
 * exempt from the passphrase gate.
 *
 * Fails closed: with INGEST_SECRET unset it refuses everything rather than
 * accepting anonymous writes. Returns null when allowed, else a reason string.
 */
export function authorizeCollector(request: Request): string | null {
  const secret = process.env.INGEST_SECRET;
  if (!secret) return "Ingest endpoint is not configured — set INGEST_SECRET.";
  const header = request.headers.get("authorization") || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : header;
  // Length-invariant compare, matching the auth module's discipline.
  if (token.length !== secret.length) return "Not authorised.";
  let diff = 0;
  for (let i = 0; i < token.length; i += 1) diff |= token.charCodeAt(i) ^ secret.charCodeAt(i);
  return diff === 0 ? null : "Not authorised.";
}
