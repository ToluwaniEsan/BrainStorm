"use client";

import { useEffect, useSyncExternalStore } from "react";

// Look-and-motion preferences, kept in this browser only. clutter.css reads
// the body attributes they set.
const PREFS = {
  bubbles: { key: "clutter:bubbles", attr: "clutterNoBubbles", off: "0" },
  calm: { key: "clutter:calm", attr: "clutterCalm", on: "1" },
};

function read(key: string) {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}
function write(key: string, value: string) {
  try {
    localStorage.setItem(key, value);
  } catch {}
}
const listeners = new Set<() => void>();
const subscribe = (fn: () => void) => {
  listeners.add(fn);
  return () => void listeners.delete(fn);
};
function save(key: string, value: string) {
  write(key, value);
  apply();
  listeners.forEach((fn) => fn());
}

function apply() {
  const body = document.body.dataset;
  if (read(PREFS.bubbles.key) === PREFS.bubbles.off) body[PREFS.bubbles.attr] = "";
  else delete body[PREFS.bubbles.attr];
  if (read(PREFS.calm.key) === PREFS.calm.on) body[PREFS.calm.attr] = "";
  else delete body[PREFS.calm.attr];
}

// Mounted once in the root layout so the saved preferences apply on every page.
export function ApplyPrefs() {
  useEffect(apply, []);
  return null;
}

function Switch({ label, note, checked, onChange }: { label: string; note: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <div className="c-set">
      <div className="c-grow">
        <b>{label}</b>
        <p className="c-muted">{note}</p>
      </div>
      <label className="c-switch">
        <input type="checkbox" aria-label={label} checked={checked} onChange={(e) => onChange(e.target.checked)} />
        <span />
      </label>
    </div>
  );
}

export function MotionSettings() {
  const bubbles = useSyncExternalStore(subscribe, () => read(PREFS.bubbles.key) !== PREFS.bubbles.off, () => true);
  const calm = useSyncExternalStore(subscribe, () => read(PREFS.calm.key) === PREFS.calm.on, () => false);
  return (
    <>
      <Switch
        label="Background bubbles"
        note="The lava lamp behind Home, Studio, Profile and Settings."
        checked={bubbles}
        onChange={(v) => save(PREFS.bubbles.key, v ? "1" : PREFS.bubbles.off)}
      />
      <Switch
        label="Calm motion"
        note="Stops the drifting bubbles and background. Your device's reduce-motion setting does this too."
        checked={calm}
        onChange={(v) => save(PREFS.calm.key, v ? PREFS.calm.on : "0")}
      />
    </>
  );
}
