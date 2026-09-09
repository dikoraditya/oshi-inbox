"use client";

import { useMemo, useState } from "react";

import { initialsOf, unreadLabel } from "@/lib/text";
import { SOURCES, type Member, type Message } from "@/lib/types";
import type { CosmFetchSummary } from "@/lib/store";

/** "All" is a sentinel, not a real group/source. */
export type GroupFilter = string;
export type SourceFilter = (typeof SOURCES)[number] | "All";

/** Inbox preview line: the text, or a media label when a message has only media. */
function previewText(message: Message | undefined): string {
  if (!message) return "";
  if (message.jp.trim()) return message.jp;
  if (message.imageUrl) {
    return message.mediaType === "video"
      ? "Video"
      : message.mediaType === "audio"
        ? "Audio"
        : "Photo";
  }
  return "";
}

/** A member's avatar: their profile image, falling back to name initials. */
function Avatar({ member }: { member: Member }) {
  if (member.avatarUrl) {
    // eslint-disable-next-line @next/next/no-img-element -- arbitrary CDN host
    return <img className="row-avatar row-avatar--img" src={member.avatarUrl} alt="" />;
  }
  return (
    <div className="row-avatar" aria-hidden="true">
      {initialsOf(member.name)}
    </div>
  );
}

export function InboxView({
  members,
  messages,
  groups,
  query,
  groupFilter,
  sourceFilter,
  onQuery,
  onGroupFilter,
  onSourceFilter,
  onOpen,
  onOpenUnassigned,
  onFetchAll,
  onSyncApps,
}: {
  members: Member[];
  messages: Message[];
  /** Group names from the database, in display order. */
  groups: string[];
  query: string;
  groupFilter: GroupFilter;
  sourceFilter: SourceFilter;
  onQuery: (value: string) => void;
  onGroupFilter: (value: GroupFilter) => void;
  onSourceFilter: (value: SourceFilter) => void;
  onOpen: (memberId: string) => void;
  onOpenUnassigned: (messageId: string) => void;
  /** Present only when COSM members exist; triggers a server-side pull of all rooms. */
  onFetchAll?: () => Promise<CosmFetchSummary>;
  /** Queue the browser-driven sources (Weverse/Nogizaka) on the local collector. */
  onSyncApps?: () => Promise<void>;
}) {
  /** Latest message per member, for the one-line preview. */
  const latest = useMemo(() => {
    const map = new Map<string, Message>();
    for (const message of messages) {
      if (!message.memberId) continue;
      const current = map.get(message.memberId);
      if (!current || message.createdAt >= current.createdAt) map.set(message.memberId, message);
    }
    return map;
  }, [messages]);

  /** Ingested mail whose sender we could not attribute to anyone yet. */
  const unassigned = useMemo(
    () => messages.filter((message) => !message.memberId),
    [messages],
  );

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return members.filter(
      (member) =>
        (groupFilter === "All" || member.group === groupFilter) &&
        (sourceFilter === "All" || member.source === sourceFilter) &&
        (!needle || member.name.toLowerCase().includes(needle)),
    );
  }, [members, groupFilter, sourceFilter, query]);

  /** Bucket by group, in the database's order, dropping empty buckets. */
  const buckets = useMemo(
    () =>
      groups
        .map((group) => {
          // Most recently active member first, matching a messaging inbox.
          const rows = filtered
            .filter((member) => member.group === group)
            .sort((a, b) => (latest.get(b.id)?.createdAt ?? 0) - (latest.get(a.id)?.createdAt ?? 0));
          return {
            group,
            rows,
            unread: rows.reduce((total, member) => total + member.unread, 0),
          };
        })
        .filter((bucket) => bucket.rows.length > 0),
    [filtered, groups, latest],
  );

  const totalUnread = members.reduce((total, member) => total + member.unread, 0);

  const [fetching, setFetching] = useState(false);
  const [fetchNote, setFetchNote] = useState<string | null>(null);

  async function runFetchAll() {
    if (!onFetchAll) return;
    setFetching(true);
    setFetchNote(null);
    try {
      const result = await onFetchAll();
      setFetchNote(result.inserted > 0 ? `+${result.inserted} new` : "Up to date");
    } catch (error) {
      setFetchNote(error instanceof Error ? error.message : "Fetch failed");
    } finally {
      setFetching(false);
    }
  }

  async function runSyncApps() {
    if (!onSyncApps) return;
    setFetchNote(null);
    try {
      await onSyncApps();
      setFetchNote("Weverse/Nogizaka queued — they'll appear shortly");
    } catch (error) {
      setFetchNote(error instanceof Error ? error.message : "Could not queue");
    }
  }

  return (
    <>
      <div className="inbox-head">
        <div className="inbox-titlerow">
          <h1 className="inbox-title">Inbox</h1>
          <div className="inbox-unread">{totalUnread} unread</div>
          {onFetchAll && (
            <button type="button" className="btn-fetch" disabled={fetching} onClick={runFetchAll}>
              {fetching ? "Fetching…" : "Fetch"}
            </button>
          )}
          {onSyncApps && (
            <button type="button" className="btn-fetch btn-fetch--ghost" onClick={runSyncApps}>
              Sync apps
            </button>
          )}
        </div>
        {fetchNote && <div className="inbox-fetchnote">{fetchNote}</div>}

        <input
          className="input input--search"
          type="search"
          value={query}
          placeholder="Search a member"
          aria-label="Search a member"
          onChange={(event) => onQuery(event.target.value)}
        />

        <div className="chiprow chiprow--group">
          {["All", ...groups].map((group) => (
            <button
              key={group}
              type="button"
              className="chip-group"
              aria-pressed={groupFilter === group}
              onClick={() => onGroupFilter(group)}
            >
              {group === "All" ? "All groups" : group}
            </button>
          ))}
        </div>

        <div className="chiprow chiprow--source">
          {(["All", ...SOURCES] as SourceFilter[]).map((source) => (
            <button
              key={source}
              type="button"
              className="chip-source"
              aria-pressed={sourceFilter === source}
              onClick={() => onSourceFilter(source)}
            >
              {source === "All" ? "Every source" : source}
            </button>
          ))}
        </div>
      </div>

      <div className="scroll">
        {/* Ingested mail we could not attribute. Sits above everything, because
            it is the only thing here that needs a decision from you. */}
        {unassigned.length > 0 && (
          <section>
            <div className="grouphead grouphead--alert">
              <div className="kicker">Unassigned</div>
              <div className="meta">{unassigned.length} to file</div>
            </div>
            {unassigned.map((message) => (
              <button
                key={message.id}
                type="button"
                className="row"
                onClick={() => onOpenUnassigned(message.id)}
              >
                <div className="row-avatar" aria-hidden="true">
                  ?
                </div>
                <div className="row-body">
                  <div className="row-top">
                    <div className="row-name">{message.fromName || message.fromEmail}</div>
                    <div className="row-spacer" />
                    <div className="row-time">{message.time}</div>
                  </div>
                  <div className="row-badges">
                    <div className="badge-source">{message.source}</div>
                    <div className="badge-unread">Who?</div>
                  </div>
                  <div className="row-preview" lang="ja">
                    {previewText(message)}
                  </div>
                </div>
              </button>
            ))}
          </section>
        )}

        {buckets.map((bucket) => (
          <section key={bucket.group}>
            <div className="grouphead">
              <div className="kicker">{bucket.group}</div>
              <div className="meta">{bucket.unread} unread</div>
            </div>

            {bucket.rows.map((member) => {
              const preview = latest.get(member.id);
              return (
                <button
                  key={member.id}
                  type="button"
                  className="row"
                  onClick={() => onOpen(member.id)}
                >
                  <Avatar member={member} />
                  <div className="row-body">
                    <div className="row-top">
                      <div className="row-name">{member.name}</div>
                      <div className="row-spacer" />
                      <div className="row-time">{preview?.time ?? ""}</div>
                    </div>
                    <div className="row-badges">
                      <div className="badge-source">{member.source}</div>
                      {member.unread > 0 && (
                        <div className="badge-unread">{unreadLabel(member.unread)}</div>
                      )}
                    </div>
                    <div className="row-preview" lang="ja">
                      {previewText(preview)}
                    </div>
                  </div>
                </button>
              );
            })}
          </section>
        ))}

        {buckets.length === 0 && unassigned.length === 0 && (
          <div className="empty">No messages match those filters.</div>
        )}

        <div style={{ height: 24 }} />
      </div>
    </>
  );
}
