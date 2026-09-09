"use client";

import { useMemo, useState } from "react";

import { MessagePhoto } from "./MessagePhoto";
import type { Member, Message } from "@/lib/types";

/**
 * Files an ingested mail whose sender the app didn't recognise.
 *
 * Assigning also teaches the mapping: the address is remembered against that
 * member, so the next mail from it routes itself. That is the whole "rules
 * engine" — one tap, once per new sender.
 */
export function AssignView({
  message,
  members,
  onCancel,
  onAssign,
}: {
  message: Message;
  members: Member[];
  onCancel: () => void;
  onAssign: (memberId: string) => Promise<void> | void;
}) {
  const [query, setQuery] = useState("");
  const [picked, setPicked] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const matches = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return members.filter((m) => !needle || m.name.toLowerCase().includes(needle));
  }, [members, query]);

  async function submit() {
    if (!picked) return;
    setBusy(true);
    setError(null);
    try {
      await onAssign(picked);
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "Could not file that message.");
      setBusy(false);
    }
  }

  return (
    <>
      <div className="viewhead">
        <button type="button" className="backbtn" onClick={onCancel} aria-label="Back to inbox">
          ←
        </button>
        <div className="viewhead-text">
          <h1 className="viewhead-title">Who sent this?</h1>
          <div className="viewhead-meta">{message.fromEmail}</div>
        </div>
      </div>

      <div className="scroll editor-scroll">
        <div className="field">
          <div className="kicker">The message</div>
          <div className="msg-body">
            {message.imageUrl && (
              <MessagePhoto url={message.imageUrl} source={message.source} mediaType={message.mediaType} />
            )}
            <div className="sent-jp" lang="ja">
              {message.jp}
            </div>
          </div>
        </div>

        <div className="field">
          <div className="kicker">From</div>
          <div className="assign-from">
            <div className="assign-from-name">{message.fromName || "(no display name)"}</div>
            <div className="assign-from-mail">{message.fromEmail}</div>
          </div>
          <div className="drop-sub">
            Filing this remembers the address, so future mail from it lands in that thread
            automatically.
          </div>
        </div>

        <div className="field">
          <div className="kicker">Member</div>
          <input
            className="input"
            type="search"
            value={query}
            placeholder="Search a member"
            aria-label="Search a member"
            onChange={(event) => setQuery(event.target.value)}
          />
          <div className="picker picker--tall">
            {matches.map((member) => (
              <button
                key={member.id}
                type="button"
                className="chip-pick"
                aria-pressed={picked === member.id}
                onClick={() => setPicked(member.id)}
              >
                {member.name}
              </button>
            ))}
            {matches.length === 0 && (
              <div className="drop-sub">No member matches that search.</div>
            )}
          </div>
        </div>

        {error && <div className="msg-note msg-note--error">{error}</div>}

        <div style={{ height: 8 }} />
      </div>

      <div className="editor-foot">
        <button
          type="button"
          className="btn btn-primary"
          style={{ justifyContent: "flex-start" }}
          disabled={!picked || busy}
          onClick={() => void submit()}
        >
          {busy ? "Filing…" : "File message"}
        </button>
        <div style={{ flex: "1 1 auto" }} />
        <div className="savehint">Remembers this sender</div>
      </div>
    </>
  );
}
