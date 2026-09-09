"use client";

import { useEffect, useMemo, useRef, useState } from "react";

import type { Draft } from "@/lib/store";
import { PLACEHOLDER_IMAGE, SOURCES, type Member, type Message, type Source } from "@/lib/types";

/**
 * Capture / edit.
 *
 * One form serves both "New entry" and "Edit entry" — the design deliberately
 * reused it so that fixing a message later is the same gesture as adding one.
 *
 * The only field that matters is the Japanese: romaji, English and the word
 * glosses are produced by the translator after save, never typed here.
 */

type ImageState =
  | { kind: "keep"; url: string | null }
  | { kind: "new"; file: File }
  | { kind: "none" };

export function EditorView({
  members,
  editing,
  initialMemberId,
  onCancel,
  onSave,
  onDelete,
}: {
  members: Member[];
  /** The message being edited, or null for a new entry. */
  editing: Message | null;
  /** Which member a new entry starts on. */
  initialMemberId: string;
  onCancel: () => void;
  onSave: (draft: Draft) => void;
  onDelete: (messageId: string) => void;
}) {
  const isNew = editing === null;

  const [memberId, setMemberId] = useState(editing?.memberId ?? initialMemberId);
  const [jp, setJp] = useState(editing?.jp ?? "");
  const [time, setTime] = useState(editing?.time ?? "just now");
  const [source, setSource] = useState<Source>(
    editing?.source ?? members.find((m) => m.id === (editing?.memberId ?? initialMemberId))?.source ?? SOURCES[0],
  );
  const [image, setImage] = useState<ImageState>(
    editing?.imageUrl ? { kind: "keep", url: editing.imageUrl } : { kind: "none" },
  );
  const [memberQuery, setMemberQuery] = useState("");
  const [dragOver, setDragOver] = useState(false);

  const fileInput = useRef<HTMLInputElement>(null);

  const member = members.find((m) => m.id === memberId) ?? null;

  const matches = useMemo(() => {
    const needle = memberQuery.trim().toLowerCase();
    return members.filter((m) => !needle || m.name.toLowerCase().includes(needle));
  }, [members, memberQuery]);

  /** Local preview for a not-yet-uploaded file; revoked on change/unmount. */
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  useEffect(() => {
    if (image.kind !== "new") {
      setPreviewUrl(null);
      return;
    }
    const url = URL.createObjectURL(image.file);
    setPreviewUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [image]);

  /**
   * Accept a screenshot pasted from anywhere while the editor is open — the
   * design's "⌘V from the source app" affordance, which only works if the
   * listener is on the document rather than on a focused field.
   */
  useEffect(() => {
    function onPaste(event: ClipboardEvent) {
      const item = Array.from(event.clipboardData?.items ?? []).find((i) =>
        i.type.startsWith("image/"),
      );
      if (!item) return;
      const file = item.getAsFile();
      if (!file) return;
      event.preventDefault();
      setImage({ kind: "new", file });
    }

    document.addEventListener("paste", onPaste);
    return () => document.removeEventListener("paste", onPaste);
  }, []);

  function attachFile(file: File | undefined | null) {
    if (file && file.type.startsWith("image/")) setImage({ kind: "new", file });
  }

  const hasImage = image.kind === "new" || (image.kind === "keep" && image.url !== null);
  const canSave = jp.trim().length > 0 && member !== null;

  function submit() {
    if (!canSave || !member) return;
    onSave({
      id: editing?.id ?? null,
      memberId: member.id,
      jp,
      time,
      source,
      image,
    });
  }

  return (
    <>
      <div className="viewhead">
        <button type="button" className="backbtn" onClick={onCancel} aria-label="Cancel">
          ←
        </button>
        <div className="viewhead-text">
          <h1 className="viewhead-title">{isNew ? "New entry" : "Edit entry"}</h1>
          <div className="viewhead-meta">
            {member?.name ?? "No member"} · {source}
          </div>
        </div>
      </div>

      <div className="scroll editor-scroll">
        {/* ── Member ───────────────────────────────────────────────────── */}
        <div className="field">
          <div className="kicker">Member</div>
          <input
            className="input"
            type="search"
            value={memberQuery}
            placeholder="Search a member"
            aria-label="Search a member"
            onChange={(event) => setMemberQuery(event.target.value)}
          />
          <div className="picker">
            {matches.slice(0, 8).map((candidate) => (
              <button
                key={candidate.id}
                type="button"
                className="chip-pick"
                aria-pressed={candidate.id === memberId}
                onClick={() => {
                  setMemberId(candidate.id);
                  // Follow the member's usual app, as the design did on pick.
                  setSource(candidate.source);
                }}
              >
                {candidate.name}
              </button>
            ))}
            {matches.length === 0 && (
              <div className="drop-sub">No member matches that search.</div>
            )}
          </div>
        </div>

        {/* ── Source ───────────────────────────────────────────────────── */}
        <div className="field">
          <div className="kicker">Source</div>
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
        </div>

        {/* ── Picture ──────────────────────────────────────────────────── */}
        <div className="field">
          <div className="kicker">Picture</div>

          {hasImage ? (
            <div className="shot">
              {image.kind === "new" && previewUrl ? (
                // eslint-disable-next-line @next/next/no-img-element -- blob: URL
                <img src={previewUrl} alt="Attached screenshot" />
              ) : (
                image.kind === "keep" &&
                image.url &&
                image.url !== PLACEHOLDER_IMAGE && (
                  // eslint-disable-next-line @next/next/no-img-element -- arbitrary Blob host
                  <img src={image.url} alt="Attached screenshot" />
                )
              )}
              <div className="shot-label">Screenshot attached</div>
              <button
                type="button"
                className="shot-remove"
                onClick={() => setImage({ kind: "none" })}
              >
                Remove
              </button>
            </div>
          ) : (
            <button
              type="button"
              className="drop"
              data-over={dragOver}
              onClick={() => fileInput.current?.click()}
              onDragOver={(event) => {
                event.preventDefault();
                setDragOver(true);
              }}
              onDragLeave={() => setDragOver(false)}
              onDrop={(event) => {
                event.preventDefault();
                setDragOver(false);
                attachFile(event.dataTransfer.files?.[0]);
              }}
            >
              <span className="drop-title">Paste or drop a screenshot</span>
              <span className="drop-sub">⌘V from the source app, or pick from camera roll</span>
            </button>
          )}

          <input
            ref={fileInput}
            type="file"
            accept="image/*"
            hidden
            onChange={(event) => {
              attachFile(event.target.files?.[0]);
              // Allow re-picking the same file immediately.
              event.target.value = "";
            }}
          />
        </div>

        {/* ── Japanese ─────────────────────────────────────────────────── */}
        <div className="field">
          <div className="field-head">
            <div className="kicker">Japanese</div>
            <div className="meta">{jp.length} characters</div>
          </div>
          <textarea
            className="textarea-jp"
            rows={5}
            value={jp}
            lang="ja"
            aria-label="Japanese message"
            onChange={(event) => setJp(event.target.value)}
          />
        </div>

        {/* ── Time stamp ───────────────────────────────────────────────── */}
        <div className="field">
          <div className="kicker">Time stamp</div>
          <input
            className="input"
            value={time}
            aria-label="Time stamp"
            onChange={(event) => setTime(event.target.value)}
          />
        </div>

        <div className="editor-note">
          Romaji, English and the tappable words are generated after you save — the reading side
          fills in as they come back.
        </div>

        <div style={{ height: 8 }} />
      </div>

      <div className="editor-foot">
        <button
          type="button"
          className="btn btn-primary"
          style={{ justifyContent: "flex-start" }}
          disabled={!canSave}
          onClick={submit}
        >
          Save entry
        </button>

        {editing && (
          <button
            type="button"
            className="btn btn-secondary"
            style={{ justifyContent: "flex-start" }}
            onClick={() => onDelete(editing.id)}
          >
            Delete
          </button>
        )}

        <div style={{ flex: "1 1 auto" }} />
        <div className="savehint">{isNew ? "Appends to the thread" : "Overwrites the entry"}</div>
      </div>
    </>
  );
}
