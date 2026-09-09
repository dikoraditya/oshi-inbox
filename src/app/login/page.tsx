"use client";

import { useState } from "react";

export default function LoginPage() {
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);

    const response = await fetch("/api/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password }),
    });

    if (response.ok) {
      // Full reload so middleware re-evaluates with the new cookie.
      window.location.href = "/";
      return;
    }

    const payload = (await response.json().catch(() => null)) as { error?: string } | null;
    setError(payload?.error ?? "Could not sign in.");
    setBusy(false);
  }

  return (
    <main className="stage">
      <div className="phone" style={{ height: "auto", minHeight: 320, justifyContent: "center" }}>
        <form
          onSubmit={submit}
          style={{ padding: 24, display: "flex", flexDirection: "column", gap: 14 }}
        >
          <h1 className="inbox-title">Oshi Inbox</h1>
          <div className="viewhead-meta">Passphrase required</div>

          <input
            className="input"
            type="password"
            value={password}
            autoFocus
            placeholder="Passphrase"
            aria-label="Passphrase"
            onChange={(event) => setPassword(event.target.value)}
          />

          {error && <div className="msg-note msg-note--error">{error}</div>}

          <button type="submit" className="btn btn-primary" disabled={busy || !password}>
            {busy ? "Checking…" : "Enter"}
          </button>
        </form>
      </div>
    </main>
  );
}
