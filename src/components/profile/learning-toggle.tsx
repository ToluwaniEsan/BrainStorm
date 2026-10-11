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
    <div>
      <div className="c-set">
        <div className="c-grow">
          <b id="learning-label">Learn about me from my conversations</b>
          <p className="c-muted">
            {enabled
              ? "On: as you talk or type, Clutter notes lasting things about you (goals, projects, skills you mention) so it can ground its questions in your own history. Everything it learns is listed on your profile, and you can delete any of it."
              : "Off: Clutter only uses what you give it on your profile (intro, links, documents) and what it learned before. It will not pick up anything new from your conversations."}
          </p>
        </div>
        <label className="c-switch">
          <input
            type="checkbox"
            aria-labelledby="learning-label"
            checked={enabled}
            disabled={saving}
            onChange={(e) => (e.target.checked ? void set(true) : setConfirming(true))}
          />
          <span />
        </label>
      </div>
      {confirming && (
        <div role="alertdialog" aria-labelledby="stop-learning-title" className="c-alert">
          <b id="stop-learning-title">Stop learning from your conversations?</b>
          <ul>
            <li>Clutter will stop noting new things about you from what you say or type.</li>
            <li>It will still use your profile, links and documents, and anything it already learned (delete those on your profile if you want them gone).</li>
            <li>Tracks and replies keep working, but its follow-up questions cannot build on new things you tell it.</li>
            <li>You can turn learning back on at any time.</li>
          </ul>
          <div className="c-row">
            <button disabled={saving} onClick={() => void set(false)} className="c-btn small">
              Stop learning
            </button>
            <button disabled={saving} onClick={() => setConfirming(false)} className="c-btn ghost small">
              Keep learning
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
