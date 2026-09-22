"use client";

import { useMemo, useState } from "react";

import { initialsOf } from "@/lib/text";
import { SOURCES, type Member, type Message } from "@/lib/types";

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
  onSync,
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
  onSync?: () => Promise<{ queued: string[] }>;
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

  /** Every started thread, ordered purely by latest-message date — no group buckets. */
  const threads = useMemo(
    () =>
      filtered
        .filter((member) => latest.has(member.id))
        .sort((a, b) => (latest.get(b.id)?.createdAt ?? 0) - (latest.get(a.id)?.createdAt ?? 0)),
    [filtered, latest],
  );

  /** Members with no message yet — parked at the very bottom, below every thread. */
  const emptyMembers = useMemo(() => {
    const order: Record<string, number> = Object.fromEntries(
      groups.map((group, index) => [group, index]),
    );
    return filtered
      .filter((member) => !latest.has(member.id))
      .sort(
        (a, b) =>
          (order[a.group] ?? Infinity) - (order[b.group] ?? Infinity) ||
          a.name.localeCompare(b.name),
      );
  }, [filtered, groups, latest]);


  const [syncing, setSyncing] = useState(false);
  const [syncNote, setSyncNote] = useState<string | null>(null);
  async function runSync() {
    if (!onSync) return;
    setSyncing(true);
    setSyncNote(null);
    try {
      const { queued } = await onSync();
      setSyncNote(
        queued.length ? `Queued ${queued.join(", ")} — pulling on your linked machine…` : "Nothing to sync.",
      );
    } catch (error) {
      setSyncNote(error instanceof Error ? error.message : "Sync failed.");
    } finally {
      setSyncing(false);
    }
  }
  return (
    <>
      <div className="inbox-head">
        <div className="inbox-titlerow">
          <h1 className="inbox-title">Inbox</h1>
          {onSync && (
            <button
              type="button"
              className="btn btn-secondary"
              disabled={syncing}
              onClick={() => void runSync()}
              title={syncNote ?? "Pull Weverse / Nogizaka via your linked collector"}
            >
              {syncing ? "Syncing…" : "Sync apps"}
            </button>
          )}
        </div>
        {syncNote && <div className="drop-sub">{syncNote}</div>}

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

        <section>
          {threads.map((member) => {
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
                  </div>
                  <div className="row-preview" lang="ja">
                    {previewText(preview)}
                  </div>
                </div>
              </button>
            );
          })}
        </section>

        {emptyMembers.length > 0 && (
          <section>
            <div className="grouphead">
              <div className="kicker">No messages yet</div>
              <div className="meta">{emptyMembers.length}</div>
            </div>
            {emptyMembers.map((member) => (
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
                  </div>
                  <div className="row-badges">
                    <div className="badge-source">{member.source}</div>
                  </div>
                  <div className="row-preview row-preview--muted">No messages yet</div>
                </div>
              </button>
            ))}
          </section>
        )}

        {threads.length === 0 && unassigned.length === 0 && emptyMembers.length === 0 && (
          <div className="empty">No messages match those filters.</div>
        )}

        <div style={{ height: 24 }} />
      </div>
    </>
  );
}
