"use client";

import type { Member, Message } from "./types";

/**
 * Offline read cache.
 *
 * Postgres is now the source of truth, so IndexedDB's job is narrower than it
 * was: hold the last snapshot the server sent, so the app opens instantly and
 * still renders when the network is gone.
 *
 * Deliberately a single snapshot row rather than per-message records — there is
 * no local mutation to reconcile, so anything finer grained would be structure
 * without purpose.
 */

const DB_NAME = "oshi-inbox-cache";
const DB_VERSION = 1;
const STORE = "snapshot";
const KEY = "latest";

export interface Snapshot {
  members: Member[];
  messages: Message[];
  groups: string[];
  savedAt: number;
}

let dbPromise: Promise<IDBDatabase> | null = null;

function openDb(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;

  dbPromise = new Promise((resolve, reject) => {
    if (typeof indexedDB === "undefined") {
      reject(new Error("IndexedDB unavailable"));
      return;
    }
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE);
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });

  return dbPromise;
}

export async function readSnapshot(): Promise<Snapshot | null> {
  try {
    const db = await openDb();
    return await new Promise<Snapshot | null>((resolve, reject) => {
      const tx = db.transaction(STORE, "readonly");
      const request = tx.objectStore(STORE).get(KEY);
      request.onsuccess = () => resolve((request.result as Snapshot) ?? null);
      request.onerror = () => reject(request.error);
    });
  } catch {
    // A missing cache is normal, not an error worth surfacing.
    return null;
  }
}

export async function writeSnapshot(
  members: Member[],
  messages: Message[],
  groups: string[],
): Promise<void> {
  try {
    const db = await openDb();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE, "readwrite");
      tx.objectStore(STORE).put(
        { members, messages, groups, savedAt: Date.now() } satisfies Snapshot,
        KEY,
      );
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
  } catch {
    // Private browsing blocks IndexedDB; the app works, just without offline.
  }
}
