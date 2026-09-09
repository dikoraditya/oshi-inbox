/**
 * Single-user passphrase gate.
 *
 * Moving storage to a server puts your messages behind a public URL, so the app
 * needs *some* door. This is deliberately the smallest thing that works: one
 * shared passphrase, an HMAC-signed cookie, no user table.
 *
 * Uses Web Crypto only, so the same code runs in middleware (edge) and in route
 * handlers (node).
 */

export const SESSION_COOKIE = "oshi_session";

/** Thirty days — this is a personal app, not a bank. */
const TTL_MS = 30 * 24 * 60 * 60 * 1000;

function encoder() {
  return new TextEncoder();
}

function toBase64Url(bytes: ArrayBuffer | Uint8Array): string {
  const view = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let binary = "";
  for (const byte of view) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

async function hmac(payload: string, secret: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    encoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign("HMAC", key, encoder().encode(payload));
  return toBase64Url(signature);
}

/** Length-invariant comparison, so the check can't be timed. */
function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export async function issueSession(secret: string): Promise<string> {
  const expires = String(Date.now() + TTL_MS);
  return `${expires}.${await hmac(expires, secret)}`;
}

export async function verifySession(token: string | undefined, secret: string): Promise<boolean> {
  if (!token) return false;
  const [expires, signature] = token.split(".");
  if (!expires || !signature) return false;
  if (Number(expires) < Date.now()) return false;
  return safeEqual(signature, await hmac(expires, secret));
}

export function sessionCookieOptions(): {
  httpOnly: true;
  sameSite: "lax";
  secure: boolean;
  path: string;
  maxAge: number;
} {
  return {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: Math.floor(TTL_MS / 1000),
  };
}
