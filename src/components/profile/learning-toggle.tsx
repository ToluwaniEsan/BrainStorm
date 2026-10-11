"use client";

import { useState } from "react";

// Switch for "learn from my conversations". Turning it off first explains
// what changes, and only saves once the user confirms.
export function LearningToggle({ enabled, onChange }: { enabled: boolean; onChange: (v: boolean) => Promise<void> }) {
  const [confirming, setConfirming] = useState(false);
  const [saving, setSaving] = useState(false);

  async function set(v: boolean) {
    setSaving(true);
    try {
      await onChange(v);
    } finally {
      setSaving(false);
      setConfirming(false);
    }
  }

  return (
    <div className="flex flex-col gap-3">
      <label className="flex items-center gap-3">
        <input
          type="checkbox"
          className="h-5 w-5"
          checked={enabled}
          disabled={saving}
          onChange={(e) => (e.target.checked ? void set(true) : setConfirming(true))}
        />
        <span className="font-medium">Learn about me from my conversations</span>
      </label>
      <p className="text-sm text-zinc-600 dark:text-zinc-400">
        {enabled
          ? "On: as you talk or type, Clutter notes lasting things about you (goals, projects, skills you mention) so it can ground its questions in your own history. Everything it learns is listed below, and you can delete any of it."
          : "Off: Clutter only uses what you give it here (profile, links, documents) and what it learned before. It will not pick up anything new from your conversations."}
      </p>
      {confirming && (
        <div role="alertdialog" aria-labelledby="stop-learning-title" className="rounded-lg border border-amber-400 bg-amber-50 p-4 text-sm text-zinc-900">
          <p id="stop-learning-title" className="mb-2 font-semibold">Stop learning from your conversations?</p>
          <ul className="mb-3 list-disc pl-5">
            <li>Clutter will stop noting new things about you from what you say or type.</li>
            <li>It will still use your profile, links and documents, and anything it already learned (delete those below if you want them gone).</li>
            <li>Tracks and replies keep working, but its follow-up questions cannot build on new things you tell it.</li>
            <li>You can turn learning back on at any time.</li>
          </ul>
          <div className="flex gap-2">
            <button disabled={saving} onClick={() => void set(false)} className="rounded-md bg-zinc-900 px-3 py-1.5 text-white">
              Stop learning
            </button>
            <button disabled={saving} onClick={() => setConfirming(false)} className="rounded-md border border-zinc-400 px-3 py-1.5">
              Keep learning
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
