"use client";

import { useState } from "react";

// Deletes everything Clutter holds for the user (DELETE /api/account), after
// they type DELETE to confirm, then signs them out.
export function DeleteAccount() {
  const [open, setOpen] = useState(false);
  const [typed, setTyped] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function remove() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/account", { method: "DELETE" });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error ?? `Delete failed (${res.status})`);
      window.location.href = body.next ?? "/auth/logout";
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  }

  if (!open) {
    return (
      <button onClick={() => setOpen(true)} className="c-btn danger">
        Delete my account and data
      </button>
    );
  }
  return (
    <div className="c-alert danger">
      <b>This permanently deletes your profile, links, documents, sessions, tracks and everything Clutter learned.</b>
      <label className="c-field" style={{ marginTop: 10 }}>
        <span>Type DELETE to confirm</span>
        <input className="c-input" value={typed} onChange={(e) => setTyped(e.target.value)} />
      </label>
      {error && <p className="c-status error">{error}</p>}
      <div className="c-row">
        <button disabled={typed !== "DELETE" || busy} onClick={() => void remove()} className="c-btn danger">
          {busy ? "Deleting..." : "Delete everything"}
        </button>
        <button onClick={() => setOpen(false)} className="c-btn ghost">Cancel</button>
      </div>
    </div>
  );
}
