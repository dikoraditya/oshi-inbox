"use client";

import { useMemo, useState } from "react";

import { SOURCES, type Member, type Message, type Source } from "@/lib/types";

/**
 * Roster — the groups and members you follow.
 *
 * Members and groups are database rows, so both forms here write to the server.
 * Sources are not: they are a fixed property of the app, one per integration,
 * so the source picker is built from the SOURCES constant.
 */
export function RosterView({
  members,
  messages,
  groups,
  onAddMember,
  onAddGroup,
  onOpenMember,
}: {
  members: Member[];
  messages: Message[];
  groups: string[];
  onAddMember: (input: { name: string; group: string; source: Source }) => Promise<unknown>;
  onAddGroup: (name: string) => Promise<unknown>;
  onOpenMember: (memberId: string) => void;
}) {
  const [name, setName] = useState("");
  const [group, setGroup] = useState<string | null>(null);
  const [source, setSource] = useState<Source>(SOURCES[0]);
  const [groupName, setGroupName] = useState("");
  const [busy, setBusy] = useState<"member" | "group" | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Default to the first group once they have loaded, without stomping a choice.
  const activeGroup = group ?? groups[0] ?? null;

  /** Entry counts per member, for the "N entries" line. */
  const entryCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const message of messages) {
      if (!message.memberId) continue;
      counts.set(message.memberId, (counts.get(message.memberId) ?? 0) + 1);
    }
    return counts;
  }, [messages]);

  const buckets = useMemo(
    () =>
      groups.map((name) => ({
        label: name,
        members: members.filter((member) => member.group === name),
      })),
    [groups, members],
  );

  async function submitMember() {
    if (!name.trim() || !activeGroup) return;
    setBusy("member");
    setError(null);
    try {
      await onAddMember({ name: name.trim(), group: activeGroup, source });
      setName("");
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "Could not add that member.");
    } finally {
      setBusy(null);
    }
  }

  async function submitGroup() {
    if (!groupName.trim()) return;
    setBusy("group");
    setError(null);
    try {
      await onAddGroup(groupName.trim());
      // Select the group just created, as the design does.
      setGroup(groupName.trim());
      setGroupName("");
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "Could not add that group.");
    } finally {
      setBusy(null);
    }
  }

  return (
    <>
      <div className="roster-head">
        <h1 className="inbox-title">Idol</h1>
        <div className="roster-sub">Groups and members you follow</div>
      </div>

      <div className="scroll">
        {error && (
          <div style={{ padding: "12px 16px 0" }}>
            <div className="msg-note msg-note--error">{error}</div>
          </div>
        )}

        {/* ── Add a member ─────────────────────────────────────────────── */}
        <div className="roster-form">
          <div className="kicker">Add a member</div>

          <input
            className="input"
            value={name}
            placeholder="Member name"
            aria-label="Member name"
            onChange={(event) => setName(event.target.value)}
          />

          <div className="chiprow">
            {groups.map((candidate) => (
              <button
                key={candidate}
                type="button"
                className="chip-pick"
                aria-pressed={activeGroup === candidate}
                onClick={() => setGroup(candidate)}
              >
                {candidate}
              </button>
            ))}
            {groups.length === 0 && <div className="drop-sub">Add a group first.</div>}
          </div>

          <div className="chiprow">
            {SOURCES.map((candidate) => (
              <button
                key={candidate}
                type="button"
                className="chip-pick chip-pick--source"
                aria-pressed={source === candidate}
                onClick={() => setSource(candidate)}
              >
                {candidate}
              </button>
            ))}
          </div>

          <button
            type="button"
            className="btn btn-primary btn-block"
            disabled={!name.trim() || !activeGroup || busy !== null}
            onClick={() => void submitMember()}
          >
            {busy === "member" ? "Adding…" : "Add member"}
          </button>
        </div>

        {/* ── Add a group ──────────────────────────────────────────────── */}
        <div className="roster-form">
          <div className="kicker">Add a group</div>
          <input
            className="input"
            value={groupName}
            placeholder="Group name"
            aria-label="Group name"
            onChange={(event) => setGroupName(event.target.value)}
          />
          <button
            type="button"
            className="btn btn-secondary btn-block"
            disabled={!groupName.trim() || busy !== null}
            onClick={() => void submitGroup()}
          >
            {busy === "group" ? "Adding…" : "Add group"}
          </button>
        </div>

        {/* ── The roster ───────────────────────────────────────────────── */}
        {buckets.map((bucket) => (
          <section key={bucket.label}>
            <div className="grouphead">
              <div className="kicker">{bucket.label}</div>
              <div className="meta">
                {bucket.members.length === 1 ? "1 member" : `${bucket.members.length} members`}
              </div>
            </div>

            {bucket.members.map((member) => {
              const entries = entryCounts.get(member.id) ?? 0;
              return (
                <button
                  key={member.id}
                  type="button"
                  className="roster-row"
                  onClick={() => onOpenMember(member.id)}
                >
                  <div style={{ minWidth: 0 }}>
                    <div className="roster-name">{member.name}</div>
                    <div className="roster-meta">
                      {member.source} · {entries === 1 ? "1 entry" : `${entries} entries`}
                    </div>
                  </div>
                  <div className="roster-arrow" aria-hidden="true">
                    →
                  </div>
                </button>
              );
            })}

            {bucket.members.length === 0 && (
              <div className="empty" style={{ padding: "16px" }}>
                Nobody in this group yet.
              </div>
            )}
          </section>
        ))}

        <div style={{ height: 24 }} />
      </div>
    </>
  );
}
