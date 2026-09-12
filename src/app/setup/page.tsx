"use client";

import { useCallback, useEffect, useState } from "react";

interface Status {
  connected: boolean;
  label: string;
  watch: { expiration: number; labelId: string | null; topicName: string } | null;
  watchExpiresIn: number | null;
  env: {
    googleClientId: boolean;
    pubsubTopic: boolean;
    blobToken: boolean;
    mediaStorage: "local" | "blob" | "both";
    anthropicKey: boolean;
  };
}

function Check({ ok, children }: { ok: boolean; children: React.ReactNode }) {
  return (
    <div className="check" data-ok={ok}>
      <span className="check-mark">{ok ? "●" : "○"}</span>
      <span>{children}</span>
    </div>
  );
}

export default function SetupPage() {
  const [status, setStatus] = useState<Status | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const response = await fetch("/api/gmail/status");
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error ?? "Could not read status.");
      setStatus(payload);
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "Could not read status.");
    }
  }, []);

  useEffect(() => {
    // Surface whatever the OAuth callback redirected back with.
    const params = new URLSearchParams(window.location.search);
    if (params.get("error")) setError(params.get("error"));
    void load();
  }, [load]);

  async function renew() {
    setBusy(true);
    setError(null);
    try {
      const response = await fetch("/api/gmail/status", { method: "POST" });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error ?? "Renewal failed.");
      await load();
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "Renewal failed.");
    } finally {
      setBusy(false);
    }
  }

  const days =
    status?.watchExpiresIn != null
      ? Math.max(0, Math.floor(status.watchExpiresIn / 86_400_000))
      : null;

  return (
    <main className="stage">
      <div className="phone" style={{ height: "auto", minHeight: 600 }}>
        <div className="viewhead">
          <a className="backbtn" href="/" aria-label="Back to inbox">
            ←
          </a>
          <div className="viewhead-text">
            <h1 className="viewhead-title">Setup</h1>
            <div className="viewhead-meta">Gmail ingestion</div>
          </div>
        </div>

        <div className="scroll editor-scroll">
          {error && <div className="msg-note msg-note--error">{error}</div>}

          <div className="field">
            <div className="kicker">Environment</div>
            <Check ok={!!status?.env.googleClientId}>GOOGLE_CLIENT_ID / SECRET</Check>
            <Check ok={!!status?.env.pubsubTopic}>GMAIL_PUBSUB_TOPIC</Check>
            <Check ok={!!status?.env.anthropicKey}>ANTHROPIC_API_KEY</Check>
            <Check ok>
              Media storage:{" "}
              {status?.env.mediaStorage === "local"
                ? "local disk (public/media)"
                : status?.env.mediaStorage === "both"
                  ? "Vercel Blob + local disk"
                  : "Vercel Blob"}
            </Check>
          </div>

          <div className="field">
            <div className="kicker">Gmail</div>
            <Check ok={!!status?.connected}>
              {status?.connected ? "Connected" : "Not connected"}
            </Check>
            <Check ok={!!status?.watch}>
              {status?.watch
                ? `Watching label "${status.label}" — expires in ${days} day${days === 1 ? "" : "s"}`
                : `No active watch on label "${status?.label ?? "oshi"}"`}
            </Check>
            <div className="drop-sub">
              Gmail expires a watch after 7 days. The daily cron renews it; this button forces it.
            </div>
          </div>

          <div className="field">
            <div className="chiprow">
              <a className="btn btn-primary" href="/api/gmail/auth">
                {status?.connected ? "Reconnect Gmail" : "Connect Gmail"}
              </a>
              <button
                type="button"
                className="btn btn-secondary"
                disabled={!status?.connected || busy}
                onClick={() => void renew()}
              >
                {busy ? "Renewing…" : "Renew watch"}
              </button>
            </div>
          </div>

          <div className="editor-note">
            Mail filed into the <strong>{status?.label ?? "oshi"}</strong> label is ingested
            automatically. The first message from an unfamiliar sender lands in{" "}
            <strong>Unassigned</strong> — file it once and that address is remembered.
          </div>

          <div style={{ height: 8 }} />
        </div>
      </div>
    </main>
  );
}
