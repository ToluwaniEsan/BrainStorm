"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { Loading } from "@/components/loading";

type Session = {
  id: string;
  startedAt: string;
  endedAt: string | null;
  tracks: { title: string; items: string[] }[];
  lines: { who: "you" | "clutter"; text: string }[];
};

const COLORS = ["--c-ps", "--c-ai", "--c-ae", "--c-id", "--c-dw", "--c-lr", "--c-xd", "--c-pr", "--c-ac"];
const color = (n: number) => ({ "--c": `var(${COLORS[n % COLORS.length]})` }) as React.CSSProperties;

function when(s: Session) {
  const start = new Date(s.startedAt);
  const day = start.toDateString() === new Date().toDateString() ? "Today" : start.toLocaleDateString(undefined, { month: "short", day: "numeric" });
  const mins = s.endedAt ? Math.max(1, Math.round((new Date(s.endedAt).getTime() - start.getTime()) / 60000)) : null;
  return `${day}, ${start.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })}${mins ? ` · ${mins} min` : ""}`;
}

// Named after its first tracks, or failing that what was first said.
function titleOf(s: Session) {
  if (s.tracks.length) return s.tracks.slice(0, 2).map((t) => t.title).join(" and ") + (s.tracks.length > 2 ? " and more" : "");
  const first = s.lines.find((l) => l.who === "you")?.text.trim();
  if (!first) return "Untitled session";
  const words = first.split(/\s+/);
  return words.slice(0, 8).join(" ") + (words.length > 8 ? "..." : "");
}

// A session as plain text, for downloading.
function asText(s: Session) {
  const out = [titleOf(s), when(s), ""];
  if (s.tracks.length) {
    out.push("TRACKS");
    for (const t of s.tracks) out.push(`\n${t.title}`, ...t.items.map((i) => `  - ${i}`));
    out.push("");
  }
  if (s.lines.length) {
    out.push("WHAT WAS SAID", ...s.lines.map((l) => `${l.who === "you" ? "You" : "Clutter"}: ${l.text}`));
  }
  return out.join("\n");
}

function download(name: string, text: string) {
  const url = URL.createObjectURL(new Blob([text], { type: "text/plain;charset=utf-8" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
const fileDate = (s: Session) => new Date(s.startedAt).toISOString().slice(0, 16).replace(/[T:]/g, "-");

// Wraps every match of the search in <mark>.
function Hit({ text, q }: { text: string; q: string }) {
  if (!q) return <>{text}</>;
  const parts = text.split(new RegExp(`(${q.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")})`, "ig"));
  return (
    <>
      {parts.map((p, i) => (i % 2 ? <mark key={i} className="c-hit">{p}</mark> : p))}
    </>
  );
}

// Studio: past sessions, searchable by anything said or filed, filterable by
// track, with a detail view and a way back into a session on Home.
export function Studio() {
  const [sessions, setSessions] = useState<Session[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [chip, setChip] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);

  useEffect(() => {
    fetch("/api/studio")
      .then(async (res) => {
        const body = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(body.error ?? `Couldn't load Studio (${res.status})`);
        setSessions(body as Session[]);
      })
      .catch((err) => setError((err as Error).message));
  }, []);

  const q = query.trim();
  const titles = useMemo(() => [...new Set((sessions ?? []).flatMap((s) => s.tracks.map((t) => t.title)))].slice(0, 24), [sessions]);
  const hits = useMemo(() => {
    const needle = q.toLowerCase();
    return (sessions ?? []).filter(
      (s) =>
        (!chip || s.tracks.some((t) => t.title === chip)) &&
        (!needle ||
          [...s.tracks.flatMap((t) => [t.title, ...t.items]), ...s.lines.map((l) => l.text)].some((x) => x.toLowerCase().includes(needle))),
    );
  }, [sessions, q, chip]);
  const current = hits.find((s) => s.id === selected) ?? hits[0];

  async function remove(id: string) {
    const res = await fetch(`/api/studio/${id}`, { method: "DELETE" });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      setError(body.error ?? `Delete failed (${res.status})`);
      return;
    }
    setSessions((ss) => (ss ?? []).filter((s) => s.id !== id));
    setConfirmDelete(false);
  }

  if (error && !sessions) return <p className="c-status error">{error}</p>;
  if (!sessions) return <Loading label="Loading your sessions" />;
  if (!sessions.length) {
    return (
      <div className="c-panel">
        <p className="c-muted">
          Nothing here yet. Start a session on <Link href="/">Home</Link>; when you end it, its tracks and transcript land here.
        </p>
      </div>
    );
  }

  return (
    <>
      {error && <p className="c-status error">{error}</p>}
      <div className="c-row" style={{ justifyContent: "space-between", marginBottom: 14 }}>
        <p className="c-note">
          {sessions.length} discussion{sessions.length === 1 ? "" : "s"} saved
        </p>
        <button
          className="c-btn ghost small"
          onClick={() => download(`clutter-all-discussions-${new Date().toISOString().slice(0, 10)}.txt`, sessions.map(asText).join("\n\n==========\n\n"))}
        >
          Download all
        </button>
      </div>
      <div className="c-studio">
        <div className="c-panel">
          <label className="c-search">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
              <circle cx="11" cy="11" r="7" />
              <path d="m20 20-3.5-3.5" />
            </svg>
            <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search what you've said..." aria-label="Search sessions" />
          </label>
          {titles.length > 1 && (
            <div className="c-chips">
              {titles.map((t, n) => (
                <button key={t} className={`c-chip${chip === t ? " on" : ""}`} style={color(n)} onClick={() => setChip(chip === t ? null : t)}>
                  <i />
                  {t}
                </button>
              ))}
            </div>
          )}
          {hits.length === 0 && <p className="c-empty">Nothing matches that yet.</p>}
          {hits.map((s) => (
            <button
              key={s.id}
              className={`c-sess${current?.id === s.id ? " on" : ""}`}
              onClick={() => {
                setSelected(s.id);
                setConfirmDelete(false);
              }}
            >
              <div className="t">
                <Hit text={titleOf(s)} q={q} />
              </div>
              <div className="d">
                {when(s)} · {s.tracks.length} track{s.tracks.length === 1 ? "" : "s"}
              </div>
              <div className="dots">
                {s.tracks.map((t, n) => (
                  <i key={n} style={color(n)} />
                ))}
              </div>
            </button>
          ))}
        </div>

        {current && (
          <div className="c-panel c-detail">
            <h3>
              <Hit text={titleOf(current)} q={q} />
            </h3>
            <p className="c-note" style={{ marginBottom: 16 }}>{when(current)}</p>
            {current.tracks.length > 0 && (
              <>
                <h2>Tracks</h2>
                <div className="c-mini-grid">
                  {current.tracks.map((t, n) => (
                    <div key={n} className="c-mini" style={color(n)}>
                      <b>
                        <Hit text={t.title} q={q} />
                      </b>
                      <ul>
                        {t.items.map((i, k) => (
                          <li key={k}>
                            <Hit text={i} q={q} />
                          </li>
                        ))}
                      </ul>
                    </div>
                  ))}
                </div>
              </>
            )}
            {current.lines.length > 0 && (
              <>
                <h2>What was said</h2>
                <div className="c-transcript-box">
                  {current.lines.map((l, k) => (
                    <p key={k} className={`c-quote${l.who === "clutter" ? " clutter" : ""}`}>
                      <b>{l.who === "you" ? "You" : "Clutter"}:</b> <Hit text={l.text} q={q} />
                    </p>
                  ))}
                </div>
              </>
            )}
            <div className="c-row">
              <a className="c-btn" href={`/?session=${current.id}`}>
                Pick this back up
              </a>
              <button className="c-btn ghost" onClick={() => download(`clutter-${fileDate(current)}.txt`, asText(current))}>
                Download
              </button>
              {confirmDelete ? (
                <>
                  <button className="c-btn danger" onClick={() => void remove(current.id)}>
                    Delete this session
                  </button>
                  <button className="c-btn ghost" onClick={() => setConfirmDelete(false)}>
                    Keep it
                  </button>
                </>
              ) : (
                <button className="c-btn ghost" onClick={() => setConfirmDelete(true)}>
                  Delete
                </button>
              )}
            </div>
          </div>
        )}
      </div>
    </>
  );
}
