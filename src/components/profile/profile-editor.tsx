"use client";

import { useEffect, useState } from "react";

import { AdobeExpressButton } from "./adobe-express";
import { LearningToggle } from "./learning-toggle";
import { Loading } from "@/components/loading";

type Profile = {
  displayName: string | null; intro: string | null; aboutWork: string | null;
  learningEnabled: boolean; understanding: string | null; understandingUpdatedAt: string | null;
};
type Link = { id: string; url: string; kind: string; title: string | null; fetchedAt: string | null };
type FileRow = { id: string; filename: string; sizeBytes: number | null; createdAt: string };
type Fact = { id: string; fact: string; sourceType: string; createdAt: string };

const KINDS = [
  { value: "portfolio", label: "Portfolio" },
  { value: "repository", label: "Repository" },
  { value: "social", label: "Social / profile" },
  { value: "web", label: "Other" },
];
const kindLabel = (k: string) => KINDS.find((x) => x.value === k)?.label ?? (k === "github" ? "Repository" : k);

async function call<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, init);
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error ?? `Request failed (${res.status})`);
  return body as T;
}
const json = (method: string, body: unknown): RequestInit => ({
  method,
  headers: { "content-type": "application/json" },
  body: JSON.stringify(body),
});

const LINK_ICON: Record<string, [string, string]> = {
  portfolio: ["WEB", "--c-ps"],
  repository: ["GIT", "--c-ae"],
  github: ["GIT", "--c-ae"],
  social: ["@", "--c-id"],
  web: ["URL", "--c-lr"],
};
const fileIcon = (name: string): [string, string] => {
  const ext = name.split(".").pop()?.toLowerCase() ?? "";
  if (ext === "pdf") return ["PDF", "--c-ac"];
  if (ext === "docx") return ["DOC", "--c-ps"];
  if (["png", "jpg", "jpeg", "webp"].includes(ext)) return ["IMG", "--c-ai"];
  return ["TXT", "--c-dw"];
};
const tint = (c: string) => ({ "--c": `var(${c})` }) as React.CSSProperties;
const size = (n: number | null) => (n == null ? "" : n > 1e6 ? `${(n / 1e6).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1e3))} KB`);

// Profile page: who the user is, the links and documents that back it up,
// and what Clutter has understood or learned from all of it.
export function ProfileEditor({ authName, email }: { authName: string; email: string }) {
  const [profile, setProfile] = useState<Profile | null>(null);
  const [form, setForm] = useState({ displayName: "", intro: "", aboutWork: "" });
  const [links, setLinks] = useState<Link[]>([]);
  const [files, setFiles] = useState<FileRow[]>([]);
  const [facts, setFacts] = useState<Fact[]>([]);
  const [newLink, setNewLink] = useState({ kind: "portfolio", url: "" });
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<{ kind: "ok" | "error"; text: string } | null>(null);

  // Profile photo: shown when /api/profile/avatar has one; `photo` bumps to reload it.
  const [photo, setPhoto] = useState(1);
  const [hasPhoto, setHasPhoto] = useState(true);

  const report = (err: unknown) => setMessage({ kind: "error", text: err instanceof Error ? err.message : String(err) });

  useEffect(() => {
    let alive = true;
    Promise.all([
      call<Profile | { ok: true } | null>("/api/profile"),
      call<Link[]>("/api/links"),
      call<FileRow[]>("/api/files"),
      call<Fact[]>("/api/facts"),
    ])
      .then(([saved, l, f, fa]) => {
        if (!alive) return;
        // No profile row yet comes back as { ok: true }.
        const p = saved && "learningEnabled" in saved ? saved : null;
        setProfile(p ?? { displayName: null, intro: null, aboutWork: null, learningEnabled: true, understanding: null, understandingUpdatedAt: null });
        setForm({ displayName: p?.displayName ?? authName, intro: p?.intro ?? "", aboutWork: p?.aboutWork ?? "" });
        setLinks(l);
        setFiles(f);
        setFacts(fa);
      })
      .catch((err) => alive && setMessage({ kind: "error", text: err instanceof Error ? err.message : String(err) }));
    return () => {
      alive = false;
    };
  }, [authName]);

  async function run(label: string, fn: () => Promise<void>, done?: string) {
    setBusy(label);
    setMessage(null);
    try {
      await fn();
      if (done) setMessage({ kind: "ok", text: done });
    } catch (err) {
      report(err);
    } finally {
      setBusy(null);
    }
  }

  const saveProfile = () =>
    run("profile", async () => {
      const p = await call<Profile>("/api/profile", json("PUT", form));
      setProfile(p);
    }, "Saved. Clutter is updating what it understands about you.");

  const addLink = () =>
    run("link", async () => {
      const l = await call<Link>("/api/links", json("POST", { url: newLink.url.trim(), kind: newLink.kind }));
      setLinks((ls) => [l, ...ls]);
      setNewLink((n) => ({ ...n, url: "" }));
      // Read it straight away so it becomes part of what Clutter knows.
      const read = await call<Link>(`/api/links/${l.id}/fetch`, { method: "POST" });
      setLinks((ls) => ls.map((x) => (x.id === l.id ? read : x)));
    }, "Link added and read.");

  const readLink = (id: string) =>
    run(`read-${id}`, async () => {
      const read = await call<Link>(`/api/links/${id}/fetch`, { method: "POST" });
      setLinks((ls) => ls.map((x) => (x.id === id ? read : x)));
    }, "Link read.");

  const removeLink = (id: string) =>
    run(`del-${id}`, async () => {
      await call(`/api/links/${id}`, { method: "DELETE" });
      setLinks((ls) => ls.filter((x) => x.id !== id));
    });

  const upload = (file: File) =>
    run("upload", async () => {
      const data = new FormData();
      data.append("file", file);
      const f = await call<FileRow & { hasText: boolean }>("/api/files", { method: "POST", body: data });
      setFiles((fs) => [f, ...fs]);
      if (!f.hasText) throw new Error(`Uploaded ${f.filename}, but no text could be read from it.`);
    }, "Document uploaded and read.");

  const removeFile = (id: string) =>
    run(`delf-${id}`, async () => {
      await call(`/api/files/${id}`, { method: "DELETE" });
      setFiles((fs) => fs.filter((x) => x.id !== id));
    });

  const uploadPhoto = (file: File) =>
    run("photo", async () => {
      const data = new FormData();
      data.append("file", file);
      await call("/api/profile/avatar", { method: "PUT", body: data });
      setHasPhoto(true);
      setPhoto((v) => v + 1);
    }, "Profile photo updated.");

  const removePhoto = () =>
    run("photo", async () => {
      await call("/api/profile/avatar", { method: "DELETE" });
      setHasPhoto(false);
    });

  const removeFact = (id: string) =>
    run(`delfact-${id}`, async () => {
      await call(`/api/facts/${id}`, { method: "DELETE" });
      setFacts((fs) => fs.filter((x) => x.id !== id));
    });

  const refresh = () =>
    run("refresh", async () => {
      const { understanding } = await call<{ understanding: string | null }>("/api/profile/understanding", { method: "POST" });
      setProfile((p) => (p ? { ...p, understanding, understandingUpdatedAt: new Date().toISOString() } : p));
    });

  const setLearning = async (learningEnabled: boolean) => {
    try {
      const p = await call<Profile>("/api/profile", json("PUT", { learningEnabled }));
      setProfile(p);
      setMessage({ kind: "ok", text: learningEnabled ? "Learning is on." : "Learning is off." });
    } catch (err) {
      report(err);
    }
  };

  if (!profile) return message ? <p className={`c-status ${message.kind === "error" ? "error" : ""}`}>{message.text}</p> : <Loading label="Loading your profile" />;

  const shownName = form.displayName || authName || email;
  return (
    <div>
      <div className="c-profile-head">
        <div className="c-avatar-wrap">
          <div className="c-avatar">
            {hasPhoto ? (
              // eslint-disable-next-line @next/next/no-img-element -- private, per-user image from our own API
              <img key={photo} src={`/api/profile/avatar?v=${photo}`} alt="Your profile photo" onError={() => setHasPhoto(false)} />
            ) : (
              <span aria-hidden="true">{(shownName || "?").trim().charAt(0).toUpperCase()}</span>
            )}
          </div>
          <label className="c-avatar-edit" title="Upload a profile photo">
            {busy === "photo" ? "..." : "Edit"}
            <input
              type="file"
              accept="image/png,image/jpeg,image/webp"
              aria-label="Upload a profile photo"
              disabled={busy === "photo"}
              onChange={(e) => {
                const f = e.target.files?.[0];
                e.target.value = "";
                if (f) void uploadPhoto(f);
              }}
            />
          </label>
        </div>
        <div className="c-who">
          <b>{shownName || "Your profile"}</b>
          <span>{email}</span>
          {hasPhoto && (
            <button className="c-link" style={{ display: "block", marginTop: 4 }} disabled={!!busy} onClick={() => void removePhoto()}>
              Remove photo
            </button>
          )}
        </div>
        <div className="c-stats">
          <div className="c-stat"><b>{links.length}</b><span>links</span></div>
          <div className="c-stat"><b>{files.length}</b><span>documents</span></div>
          <div className="c-stat"><b>{facts.length}</b><span>things learned</span></div>
        </div>
      </div>

      {message && (
        <p role="status" className={`c-status ${message.kind === "error" ? "error" : ""}`}>
          {message.text}
        </p>
      )}

      <div className="c-grid2">
        <section className="c-panel">
          <h2>About you</h2>
          <label className="c-field">
            <span>Name</span>
            <input className="c-input" value={form.displayName} onChange={(e) => setForm({ ...form, displayName: e.target.value })} />
          </label>
          <label className="c-field">
            <span>Email (from your sign-in, one account per email)</span>
            <input className="c-input" style={{ opacity: 0.7 }} value={email} readOnly />
          </label>
          <label className="c-field">
            <span>Introduce yourself</span>
            <textarea className="c-input" rows={3} value={form.intro} onChange={(e) => setForm({ ...form, intro: e.target.value })} placeholder="Who you are, what you're into, what you're working towards." />
          </label>
          <label className="c-field">
            <span>Your work so far</span>
            <textarea className="c-input" rows={3} value={form.aboutWork} onChange={(e) => setForm({ ...form, aboutWork: e.target.value })} placeholder="Projects you've done, roles, things you're proud of." />
          </label>
          <button className="c-btn" disabled={busy === "profile"} onClick={() => void saveProfile()}>
            {busy === "profile" ? "Saving..." : "Save"}
          </button>
        </section>

        <section className="c-panel">
          <h2>Links Clutter can read</h2>
          <p className="c-note" style={{ marginBottom: 12 }}>
            Portfolio sites, GitHub repositories, profiles. Clutter reads each one (GitHub through its API, other pages through Exa).
          </p>
          {links.length === 0 && <p className="c-empty">No links yet.</p>}
          {links.map((l) => {
            const [label, c] = LINK_ICON[l.kind] ?? LINK_ICON.web;
            return (
              <div key={l.id} className="c-item" style={tint(c)}>
                <div className="c-ic">{label}</div>
                <div className="c-grow">
                  <a href={l.url} target="_blank" rel="noreferrer">{l.title ?? l.url}</a>
                  <small>
                    {kindLabel(l.kind)} ·{" "}
                    <button className="c-link" disabled={!!busy} onClick={() => void readLink(l.id)}>
                      {busy === `read-${l.id}` ? "Reading..." : l.fetchedAt ? "Read again" : "Read"}
                    </button>{" "}
                    ·{" "}
                    <button className="c-link danger" disabled={!!busy} onClick={() => void removeLink(l.id)}>Remove</button>
                  </small>
                </div>
                <span className={`c-tag${l.fetchedAt ? " ok" : ""}`}>{l.fetchedAt ? "Read" : "Not read yet"}</span>
              </div>
            );
          })}
          <form
            className="c-row"
            style={{ marginTop: 12 }}
            onSubmit={(e) => {
              e.preventDefault();
              if (newLink.url.trim()) void addLink();
            }}
          >
            <select className="c-input" style={{ width: "auto" }} value={newLink.kind} onChange={(e) => setNewLink({ ...newLink, kind: e.target.value })} aria-label="Link type">
              {KINDS.map((k) => (
                <option key={k.value} value={k.value}>{k.label}</option>
              ))}
            </select>
            <input className="c-input" style={{ flex: 1, minWidth: 160, width: "auto" }} type="url" required placeholder="Paste a link..." aria-label="Link" value={newLink.url} onChange={(e) => setNewLink({ ...newLink, url: e.target.value })} />
            <button className="c-btn" disabled={busy === "link"}>{busy === "link" ? "Adding..." : "Add"}</button>
          </form>
        </section>

        <section className="c-panel">
          <h2>Documents</h2>
          {files.length === 0 && <p className="c-empty">No documents yet.</p>}
          {files.map((f) => {
            const [label, c] = fileIcon(f.filename);
            return (
              <div key={f.id} className="c-item" style={tint(c)}>
                <div className="c-ic">{label}</div>
                <div className="c-grow">
                  <a href={`/api/files/${f.id}`}>{f.filename}</a>
                  <small>
                    {[size(f.sizeBytes), `added ${new Date(f.createdAt).toLocaleDateString(undefined, { month: "short", day: "numeric" })}`].filter(Boolean).join(" · ")}
                  </small>
                </div>
                <button className="c-link danger" disabled={!!busy} onClick={() => void removeFile(f.id)}>Remove</button>
              </div>
            );
          })}
          <label className="c-dropzone" style={{ marginTop: 8 }}>
            {busy === "upload" ? "Uploading and reading..." : "Add a CV, case study or brief: PDF, Word, text or images, up to 10 MB"}
            <input
              type="file"
              accept=".pdf,.docx,.txt,.md,.json,image/png,image/jpeg,image/webp"
              disabled={busy === "upload"}
              onChange={(e) => {
                const f = e.target.files?.[0];
                e.target.value = "";
                if (f) void upload(f);
              }}
            />
          </label>
          <AdobeExpressButton disabled={busy === "upload"} onDesign={(f) => void upload(f)} onError={report} />
        </section>

        <section className="c-panel">
          <h2>What Clutter understands about you</h2>
          <p className="c-note" style={{ marginBottom: 10 }}>
            Built only from what you gave it and, if learning is on, what you said. Clutter uses this to ground its questions, and
            only encourages you where your own work backs it up.
          </p>
          <p className="c-understanding">{profile.understanding ?? "Nothing yet. Add an intro, links or documents."}</p>
          <button className="c-link" disabled={!!busy} onClick={() => void refresh()}>
            {busy === "refresh" ? "Updating..." : "Update now"}
          </button>
        </section>

        <section className="c-panel c-span2">
          <h2>Learned from your conversations</h2>
          {facts.length === 0 ? (
            <p className="c-empty">Nothing learned yet.</p>
          ) : (
            <div className="c-facts">
              {facts.map((f) => (
                <span key={f.id} className="c-fact">
                  {f.fact}
                  <button aria-label={`Forget: ${f.fact}`} title="Forget this" disabled={!!busy} onClick={() => void removeFact(f.id)}>
                    ×
                  </button>
                </span>
              ))}
            </div>
          )}
          <div style={{ marginTop: 16 }}>
            <LearningToggle enabled={profile.learningEnabled} onChange={setLearning} />
          </div>
        </section>
      </div>
    </div>
  );
}
