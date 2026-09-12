"use client";

import { useMemo, useState } from "react";

import { initialsOf } from "@/lib/text";
import { type MediaType, type Member, type Message } from "@/lib/types";

/**
 * Statistics — one card per member you have actually received something from.
 *
 * For every non-empty member it answers three questions: how long you have
 * followed them (measured from their first message), how much they have sent
 * (total messages, and how many carried media), and what that media was
 * (image / audio / video). Members with no message yet are omitted entirely —
 * there is nothing to count.
 */

interface MemberStat {
  member: Member;
  total: number;
  firstAt: number;
  lastAt: number;
  media: number;
  image: number;
  audio: number;
  video: number;
}

const DAY = 86_400_000;

/** A friendly "how long have I followed them" string, from the first message. */
function subscribedFor(firstAt: number): string {
  const days = Math.floor((Date.now() - firstAt) / DAY);
  if (days < 1) return "today";
  if (days < 30) return days === 1 ? "1 day" : `${days} days`;
  const months = Math.floor(days / 30.437);
  if (months < 12) return months === 1 ? "1 month" : `${months} months`;
  const years = Math.floor(months / 12);
  const rem = months % 12;
  if (rem) return `${years}y ${rem}mo`;
  return years === 1 ? "1 year" : `${years} years`;
}

/** The exact date of the first message, for the muted "since …" line. */
function sinceDate(firstAt: number): string {
  return new Date(firstAt).toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

function Avatar({ member }: { member: Member }) {
  if (member.avatarUrl) {
    return (
      <div className="row-avatar" aria-hidden="true">
        <img src={member.avatarUrl} alt="" />
      </div>
    );
  }
  return (
    <div className="row-avatar" aria-hidden="true">
      {initialsOf(member.name)}
    </div>
  );
}

export function StatisticsView({
  members,
  messages,
}: {
  members: Member[];
  messages: Message[];
}) {
  const stats = useMemo<MemberStat[]>(() => {
    const byId = new Map<string, Member>(members.map((m) => [m.id, m]));
    const acc = new Map<string, MemberStat>();

    for (const message of messages) {
      if (!message.memberId) continue;
      const member = byId.get(message.memberId);
      if (!member) continue;

      let stat = acc.get(member.id);
      if (!stat) {
        stat = {
          member,
          total: 0,
          firstAt: message.createdAt,
          lastAt: message.createdAt,
          media: 0,
          image: 0,
          audio: 0,
          video: 0,
        };
        acc.set(member.id, stat);
      }

      stat.total += 1;
      stat.firstAt = Math.min(stat.firstAt, message.createdAt);
      stat.lastAt = Math.max(stat.lastAt, message.createdAt);

      // A message carries media whenever it has an attachment URL — including
      // the walled-off placeholder, which still represents a real photo/clip.
      if (message.imageUrl) {
        stat.media += 1;
        const kind: MediaType = message.mediaType ?? "image";
        stat[kind] += 1;
      }
    }

    // Longest-followed first; the members you have known most are up top.
    return [...acc.values()].sort((a, b) => a.firstAt - b.firstAt);
  }, [members, messages]);

  const [sortMode, setSortMode] = useState<"messages" | "followed">("messages");
  const sorted = useMemo(() => {
    const arr = [...stats];
    arr.sort(
      sortMode === "messages"
        ? (a, b) => b.total - a.total || a.firstAt - b.firstAt
        : (a, b) => a.firstAt - b.firstAt,
    );
    return arr;
  }, [stats, sortMode]);

  return (
    <>
      <div className="roster-head">
        <h1 className="inbox-title">Statistics</h1>
        <div className="roster-sub">
          {stats.length === 1 ? "1 active member" : `${stats.length} active members`}
        </div>
        <div className="chiprow chiprow--group">
          <button
            type="button"
            className="chip-source"
            aria-pressed={sortMode === "messages"}
            onClick={() => setSortMode("messages")}
          >
            Most messages
          </button>
          <button
            type="button"
            className="chip-source"
            aria-pressed={sortMode === "followed"}
            onClick={() => setSortMode("followed")}
          >
            Longest followed
          </button>
        </div>
      </div>

      <div className="scroll">
        {stats.length === 0 && <div className="empty">No messages to count yet.</div>}

        {sorted.map(({ member, total, firstAt, media, image, audio, video }) => (
          <section key={member.id} className="stat-card">
            <div className="stat-head">
              <Avatar member={member} />
              <div style={{ minWidth: 0 }}>
                <div className="roster-name">{member.name}</div>
                <div className="roster-meta">
                  {member.group} · {member.source}
                </div>
              </div>
              <div className="stat-since">
                <div className="stat-since-dur">{subscribedFor(firstAt)}</div>
                <div className="stat-since-date">since {sinceDate(firstAt)}</div>
              </div>
            </div>

            <div className="stat-grid">
              <div className="stat-cell">
                <div className="stat-num">{total}</div>
                <div className="stat-label">Messages</div>
              </div>
              <div className="stat-cell">
                <div className="stat-num">{media}</div>
                <div className="stat-label">With media</div>
              </div>
              <div className="stat-cell">
                <div className="stat-num">{total - media}</div>
                <div className="stat-label">Text only</div>
              </div>
            </div>

            <div className="stat-breakdown">
              <div className="kicker">Media breakdown</div>
              <div className="stat-chips">
                <span className="stat-chip">
                  <b>{image}</b> image{image === 1 ? "" : "s"}
                </span>
                <span className="stat-chip">
                  <b>{audio}</b> audio
                </span>
                <span className="stat-chip">
                  <b>{video}</b> video{video === 1 ? "" : "s"}
                </span>
              </div>
            </div>
          </section>
        ))}

        <div style={{ height: 24 }} />
      </div>
    </>
  );
}
