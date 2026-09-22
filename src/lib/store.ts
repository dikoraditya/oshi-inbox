"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { readSnapshot, writeSnapshot } from "./cache";
import type { Member, Message, Settings, Source } from "./types";
import { DEFAULT_SETTINGS } from "./types";

/**
 * Client state.
 *
 * Postgres is the source of truth; this hook mirrors it. On mount it paints
 * from the IndexedDB snapshot immediately (so the app opens instantly and works
 * offline), then refreshes from the server and re-caches.
 *
 * Because mail now arrives by webhook while the app is closed, the hook also
 * polls while the tab is visible — otherwise a message ingested a minute ago
 * would not appear until a manual reload.
 */

export function createId(): string {
  return typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `m-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

export interface Draft {
  id: string | null;
  memberId: string;
  jp: string;
  time: string;
  source: Source;
  /** Keep the current image, replace it with a File, or detach it. */
  image: { kind: "keep"; url: string | null } | { kind: "new"; file: File } | { kind: "none" };
}

export interface CosmFetchSummary {
  scanned: number;
  inserted: number;
}

/** The design's rule: past this length a message clamps in the reading view. */
const LONG_THRESHOLD = 90;

/** How often to look for newly ingested mail while the tab is in front. */
const POLL_MS = 60_000;

/** Cold-start paints only this recent window first, then backfills everything. */
const RECENT_WINDOW_MS = 60 * 24 * 60 * 60 * 1000;

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, {
    ...init,
    headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) },
  });

  const payload = (await response.json().catch(() => null)) as (T & { error?: string }) | null;

  if (!response.ok) {
    throw new Error(payload?.error || `Request failed with ${response.status}.`);
  }
  return payload as T;
}

export function useInbox() {
  const [ready, setReady] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [offline, setOffline] = useState(false);
  const [members, setMembers] = useState<Member[]>([]);
  const [messages, setMessages] = useState<Message[]>([]);
  /** Group names, in display order. Server-owned — the Roster screen adds to them. */
  const [groups, setGroups] = useState<string[]>([]);
  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS);

  /** Guards against overlapping refreshes from poll + focus + manual sync. */
  const refreshing = useRef(false);

  const refresh = useCallback(async (sinceMs?: number): Promise<boolean> => {
    if (refreshing.current) return false;
    refreshing.current = true;

    try {
      const data = await api<{ members: Member[]; messages: Message[]; groups: string[] }>(
        sinceMs ? `/api/messages?since=${sinceMs}` : "/api/messages",
      );
      setMembers(data.members);
      setMessages(data.messages);
      setGroups(data.groups ?? []);
      setOffline(false);
      setLoadError(null);
      // Only the full payload seeds the cache; a windowed slice must not
      // overwrite the complete snapshot the next cold start paints from.
      if (!sinceMs) void writeSnapshot(data.members, data.messages, data.groups ?? []);
      return true;
    } catch (error) {
      // A failed refresh with a warm cache is degraded, not broken.
      setOffline(true);
      setLoadError(error instanceof Error ? error.message : "Could not reach the server.");
      return false;
    } finally {
      refreshing.current = false;
    }
  }, []);

  // Paint from cache, then refresh.
  useEffect(() => {
    let cancelled = false;

    (async () => {
      const cached = await readSnapshot();
      if (cached && !cancelled) {
        setMembers(cached.members);
        setMessages(cached.messages);
        setGroups(cached.groups ?? []);
        setReady(true);
        await refresh();
        return;
      }

      // Cold start (fresh device, empty cache): paint a recent slice fast so the
      // inbox is usable in a beat, then backfill the full history behind it.
      await refresh(Date.now() - RECENT_WINDOW_MS);
      if (!cancelled) setReady(true);
      await refresh();
    })();

    return () => {
      cancelled = true;
    };
  }, [refresh]);

  // Poll for webhook-ingested mail while the tab is visible.
  useEffect(() => {
    const tick = () => {
      if (document.visibilityState === "visible") void refresh();
    };
    const id = setInterval(tick, POLL_MS);
    document.addEventListener("visibilitychange", tick);
    window.addEventListener("online", tick);
    return () => {
      clearInterval(id);
      document.removeEventListener("visibilitychange", tick);
      window.removeEventListener("online", tick);
    };
  }, [refresh]);

  /** Merge one server-returned message into local state. */
  const absorb = useCallback((message: Message) => {
    setMessages((current) => {
      const index = current.findIndex((m) => m.id === message.id);
      const next =
        index === -1 ? [...current, message] : current.map((m) => (m.id === message.id ? message : m));
      return next.sort((a, b) => a.createdAt - b.createdAt);
    });
  }, []);

  const saveDraft = useCallback(
    async (draft: Draft): Promise<Message> => {
      const existing = draft.id ? (messages.find((m) => m.id === draft.id) ?? null) : null;
      const jp = draft.jp.trim();
      const unchanged = existing !== null && existing.jp === jp;

      let imageUrl: string | null;
      if (draft.image.kind === "new") {
        const form = new FormData();
        form.append("file", draft.image.file);
        const response = await fetch("/api/upload", { method: "POST", body: form });
        const payload = (await response.json().catch(() => null)) as
          | { url?: string; error?: string }
          | null;
        if (!response.ok || !payload?.url) {
          throw new Error(payload?.error ?? "Could not upload that image.");
        }
        imageUrl = payload.url;
      } else if (draft.image.kind === "none") {
        imageUrl = null;
      } else {
        imageUrl = draft.image.url;
      }

      const body: Message = {
        id: existing?.id ?? createId(),
        memberId: draft.memberId,
        jp,
        // Unchanged Japanese keeps its translation; changed Japanese loses it.
        romaji: unchanged ? existing.romaji : "",
        en: unchanged ? existing.en : "",
        words: unchanged ? existing.words : [],
        time: draft.time.trim() || "just now",
        source: draft.source,
        imageUrl,
        long: jp.length > LONG_THRESHOLD,
        status: unchanged ? existing.status : "pending",
        error: unchanged ? (existing.error ?? null) : null,
        createdAt: existing?.createdAt ?? Date.now(),
        gmailMessageId: existing?.gmailMessageId ?? null,
        fromEmail: existing?.fromEmail ?? null,
        fromName: existing?.fromName ?? null,
      };

      const { message } = await api<{ message: Message }>("/api/messages", {
        method: "POST",
        body: JSON.stringify(body),
      });

      absorb(message);

      // The server translates in the background; pick the result up shortly.
      if (message.status === "pending") {
        setTimeout(() => void refresh(), 4000);
      }

      return message;
    },
    [absorb, messages, refresh],
  );

  const removeMessage = useCallback(async (id: string) => {
    await api(`/api/messages/${id}`, { method: "DELETE" });
    setMessages((current) => current.filter((m) => m.id !== id));
  }, []);

  /** Attribute an unassigned ingested mail, teaching the sender mapping. */
  const assignMessage = useCallback(
    async (id: string, memberId: string) => {
      const { message } = await api<{ message: Message }>(`/api/messages/${id}`, {
        method: "PATCH",
        body: JSON.stringify({ memberId }),
      });
      absorb(message);
      // The member's learned addresses changed too.
      void refresh();
      return message;
    },
    [absorb, refresh],
  );

  const retranslate = useCallback(
    async (id: string) => {
      setMessages((current) =>
        current.map((m) => (m.id === id ? { ...m, status: "pending", error: null } : m)),
      );
      await api(`/api/messages/${id}`, {
        method: "PATCH",
        body: JSON.stringify({ retranslate: true }),
      });
      setTimeout(() => void refresh(), 4000);
    },
    [refresh],
  );

  const markRead = useCallback(async (memberId: string) => {
    setMembers((current) => current.map((m) => (m.id === memberId ? { ...m, unread: 0 } : m)));
    await api(`/api/messages/${memberId}`, {
      method: "PATCH",
      body: JSON.stringify({ markRead: true }),
    }).catch(() => {
      // Cosmetic — the badge is already cleared locally.
    });
  }, []);

  /** Translate-on-read: translate a member's still-pending messages when opened. */
  const translatePending = useCallback(
    async (memberId: string) => {
      try {
        const { queued } = await api<{ queued: number }>("/api/translate", {
          method: "POST",
          body: JSON.stringify({ memberId }),
        });
        if (queued > 0) {
          setTimeout(() => void refresh(), 4000);
          setTimeout(() => void refresh(), 12000);
        }
      } catch {
        // best-effort — the visibility poll still picks up any translations
      }
    },
    [refresh],
  );

  /** Pull the pure-REST sources on demand: one attribution key, or all when omitted. */
  const fetchSources = useCallback(
    async (key?: string): Promise<CosmFetchSummary> => {
      const result = await api<CosmFetchSummary>("/api/fetch", {
        method: "POST",
        body: JSON.stringify(key === undefined ? {} : { key }),
      });
      await refresh();
      return result;
    },
    [refresh],
  );

  /** Roster: add a member. New members show in the inbox immediately, with no entries. */
  const addMember = useCallback(
    async (input: { name: string; group: string; source: Source }): Promise<Member> => {
      const { member } = await api<{ member: Member }>("/api/members", {
        method: "POST",
        body: JSON.stringify(input),
      });
      setMembers((current) => [...current, member]);
      return member;
    },
    [],
  );

  /** Roster/Edit Profile: update a member's name, avatar, blog, or add an email. */
  const updateMember = useCallback(
    async (
      id: string,
      patch: { name?: string; avatarUrl?: string | null; blogUrl?: string | null; email?: string },
    ): Promise<Member> => {
      const { member } = await api<{ member: Member }>(`/api/members/${id}`, {
        method: "PATCH",
        body: JSON.stringify(patch),
      });
      setMembers((current) => current.map((m) => (m.id === id ? member : m)));
      return member;
    },
    [],
  );

  /** Roster: add a group. The server returns the full ordered list. */
  const addGroup = useCallback(async (name: string): Promise<string[]> => {
    const data = await api<{ groups: string[] }>("/api/groups", {
      method: "POST",
      body: JSON.stringify({ name }),
    });
    setGroups(data.groups);
    return data.groups;
  }, []);

  const updateSettings = useCallback((patch: Partial<Settings>) => {
    setSettings((current) => ({ ...current, ...patch }));
  }, []);

  return {
    ready,
    loadError,
    offline,
    members,
    messages,
    groups,
    settings,
    refresh,
    addMember,
    addGroup,
    updateMember,
    saveDraft,
    removeMessage,
    assignMessage,
    retranslate,
    markRead,
    fetchSources,
    translatePending,
    updateSettings,
  };
}

export type InboxStore = ReturnType<typeof useInbox>;
