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
      <button onClick={() => setOpen(true)} className="self-start text-sm text-red-600 underline">
        Delete my account and data
      </button>
    );
  }
  return (
    <div className="flex flex-col gap-2 rounded-lg border border-red-400 bg-red-50 p-4 text-sm text-zinc-900">
      <p className="font-semibold">This permanently deletes your profile, links, documents, tracks and everything Clutter learned.</p>
      <label className="flex flex-col gap-1">
        Type DELETE to confirm
        <input className="rounded-md border border-red-300 px-3 py-2" value={typed} onChange={(e) => setTyped(e.target.value)} />
      </label>
      {error && <p className="text-red-700">{error}</p>}
      <div className="flex gap-2">
        <button disabled={typed !== "DELETE" || busy} onClick={() => void remove()} className="rounded-md bg-red-600 px-3 py-1.5 text-white disabled:opacity-50">
          {busy ? "Deleting..." : "Delete everything"}
        </button>
        <button onClick={() => setOpen(false)} className="rounded-md border border-zinc-400 px-3 py-1.5">Cancel</button>
      </div>
    </div>
  );
}
