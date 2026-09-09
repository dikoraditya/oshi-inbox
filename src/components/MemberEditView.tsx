"use client";

import { useState } from "react";

import type { Member } from "@/lib/types";

/**
 * Edit a member's profile: display name, avatar image, blog link, and the email
 * addresses that route Gmail mobame to them.
 *
 * The avatar can be a pasted URL or an uploaded file (stored in Blob via
 * /api/upload). Email is additive — typing one and saving appends it to the
 * member's learned sender addresses, so the next mail from it routes here.
 */
export function MemberEditView({
  member,
  onCancel,
  onSave,
}: {
  member: Member;
  onCancel: () => void;
  onSave: (patch: {
    name?: string;
    avatarUrl?: string | null;
    blogUrl?: string | null;
    email?: string;
  }) => Promise<unknown>;
}) {
  const [name, setName] = useState(member.name);
  const [avatarUrl, setAvatarUrl] = useState(member.avatarUrl ?? "");
  const [blogUrl, setBlogUrl] = useState(member.blogUrl ?? "");
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function upload(file: File) {
    setUploading(true);
    setError(null);
    try {
      const form = new FormData();
      form.append("file", file);
      const response = await fetch("/api/upload", { method: "POST", body: form });
      const payload = (await response.json().catch(() => null)) as
        | { url?: string; error?: string }
        | null;
      if (!response.ok || !payload?.url) throw new Error(payload?.error ?? "Upload failed.");
      setAvatarUrl(payload.url);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Upload failed.");
    } finally {
      setUploading(false);
    }
  }

  async function save() {
    setBusy(true);
    setError(null);
    try {
      await onSave({
        name: name.trim() || member.name,
        avatarUrl: avatarUrl.trim() || null,
        blogUrl: blogUrl.trim() || null,
        email: email.trim() || undefined,
      });
      onCancel();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not save.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <div className="viewhead">
        <button type="button" className="backbtn" onClick={onCancel} aria-label="Back">
          ←
        </button>
        <div className="viewhead-text">
          <h1 className="viewhead-title">Edit profile</h1>
          <div className="viewhead-meta">
            {member.group} · {member.source}
          </div>
        </div>
      </div>

      <div className="scroll">
        {error && (
          <div style={{ padding: "12px 16px 0" }}>
            <div className="msg-note msg-note--error">{error}</div>
          </div>
        )}

        <div className="roster-form">
          <div className="edit-avatar">
            {avatarUrl ? (
              // eslint-disable-next-line @next/next/no-img-element -- arbitrary CDN host
              <img className="edit-avatar-img" src={avatarUrl} alt="" />
            ) : (
              <div className="edit-avatar-img edit-avatar-img--empty" aria-hidden="true">
                {name.slice(0, 1)}
              </div>
            )}
            <label className="btn btn-secondary">
              {uploading ? "Uploading…" : "Upload image"}
              <input
                type="file"
                accept="image/*"
                style={{ display: "none" }}
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) void upload(file);
                }}
              />
            </label>
          </div>

          <div className="kicker">Name</div>
          <input
            className="input"
            value={name}
            aria-label="Name"
            onChange={(e) => setName(e.target.value)}
          />

          <div className="kicker">Avatar image URL</div>
          <input
            className="input"
            value={avatarUrl}
            placeholder="https://…"
            aria-label="Avatar image URL"
            onChange={(e) => setAvatarUrl(e.target.value)}
          />

          <div className="kicker">Blog link</div>
          <input
            className="input"
            value={blogUrl}
            placeholder="https://… (for future blog capture)"
            aria-label="Blog link"
            onChange={(e) => setBlogUrl(e.target.value)}
          />

          <div className="kicker">Add email (routes Gmail mobame here)</div>
          {member.emailAddresses.length > 0 && (
            <div className="edit-emails">{member.emailAddresses.join(", ")}</div>
          )}
          <input
            className="input"
            value={email}
            type="email"
            placeholder="member@example.com"
            aria-label="Add email"
            onChange={(e) => setEmail(e.target.value)}
          />

          <button
            type="button"
            className="btn btn-primary btn-block"
            disabled={busy || uploading}
            onClick={() => void save()}
          >
            {busy ? "Saving…" : "Save profile"}
          </button>
        </div>

        <div style={{ height: 24 }} />
      </div>
    </>
  );
}
