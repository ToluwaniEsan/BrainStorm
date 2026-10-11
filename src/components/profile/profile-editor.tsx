"use client";

import { useEffect, useState } from "react";

import { LearningToggle } from "./learning-toggle";

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

const card = "flex flex-col gap-4 rounded-xl border border-zinc-300 bg-white/80 p-5 text-zinc-900 dark:border-zinc-700 dark:bg-zinc-950/70 dark:text-zinc-100";
const input = "rounded-md border border-zinc-300 bg-transparent px-3 py-2 dark:border-zinc-700";
const button = "rounded-md bg-zinc-900 px-4 py-2 text-white disabled:opacity-50 dark:bg-zinc-100 dark:text-zinc-900";

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

  if (!profile) return <p className="w-full max-w-3xl">Loading your profile...</p>;

  return (
    <div className="flex w-full max-w-3xl flex-col gap-6">
      <h1 className="text-2xl font-semibold">Your profile</h1>
      {message && (
        <p role="status" className={`rounded-md px-3 py-2 text-sm ${message.kind === "ok" ? "bg-green-100 text-green-900" : "bg-red-100 text-red-900"}`}>
          {message.text}
        </p>
      )}

      <section className={card}>
        <h2 className="text-lg font-semibold">About you</h2>
        <label className="flex flex-col gap-1">
          <span className="text-sm">Name</span>
          <input className={input} value={form.displayName} onChange={(e) => setForm({ ...form, displayName: e.target.value })} />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-sm">Email</span>
          <input className={`${input} opacity-70`} value={email} readOnly />
          <span className="text-xs text-zinc-500">From your sign-in. One account per email.</span>
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-sm">Introduce yourself</span>
          <textarea className={input} rows={3} value={form.intro} onChange={(e) => setForm({ ...form, intro: e.target.value })} placeholder="Who you are, what you're into, what you're working towards." />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-sm">Your work so far</span>
          <textarea className={input} rows={3} value={form.aboutWork} onChange={(e) => setForm({ ...form, aboutWork: e.target.value })} placeholder="Projects you've done, roles, things you're proud of." />
        </label>
        <button className={`${button} self-start`} disabled={busy === "profile"} onClick={() => void saveProfile()}>
          {busy === "profile" ? "Saving..." : "Save"}
        </button>
      </section>

      <section className={card}>
        <h2 className="text-lg font-semibold">Links</h2>
        <p className="text-sm text-zinc-600 dark:text-zinc-400">
          Portfolio sites, GitHub repositories, profiles. Clutter reads each one (GitHub through its API, other pages through Exa).
        </p>
        <form
          className="flex flex-col gap-2 sm:flex-row"
          onSubmit={(e) => {
            e.preventDefault();
            if (newLink.url.trim()) void addLink();
          }}
        >
          <select className={input} value={newLink.kind} onChange={(e) => setNewLink({ ...newLink, kind: e.target.value })}>
            {KINDS.map((k) => (
              <option key={k.value} value={k.value}>{k.label}</option>
            ))}
          </select>
          <input className={`${input} flex-1`} type="url" required placeholder="https://..." value={newLink.url} onChange={(e) => setNewLink({ ...newLink, url: e.target.value })} />
          <button className={button} disabled={busy === "link"}>{busy === "link" ? "Adding and reading..." : "Add"}</button>
        </form>
        <ul className="flex flex-col gap-2">
          {links.length === 0 && <li className="text-sm text-zinc-500">No links yet.</li>}
          {links.map((l) => (
            <li key={l.id} className="flex flex-wrap items-center gap-2 text-sm">
              <span className="rounded bg-zinc-200 px-2 py-0.5 text-xs dark:bg-zinc-800">{kindLabel(l.kind)}</span>
              <a href={l.url} target="_blank" rel="noreferrer" className="break-all underline">{l.title ?? l.url}</a>
              <span className="text-xs text-zinc-500">{l.fetchedAt ? "read" : "not read yet"}</span>
              <span className="ml-auto flex gap-2">
                <button className="text-xs underline" disabled={!!busy} onClick={() => void readLink(l.id)}>
                  {busy === `read-${l.id}` ? "Reading..." : l.fetchedAt ? "Read again" : "Read"}
                </button>
                <button className="text-xs text-red-600 underline" disabled={!!busy} onClick={() => void removeLink(l.id)}>Remove</button>
              </span>
            </li>
          ))}
        </ul>
      </section>

      <section className={card}>
        <h2 className="text-lg font-semibold">Documents</h2>
        <p className="text-sm text-zinc-600 dark:text-zinc-400">CV, case studies, briefs. PDF, Word, text or images, up to 10 MB.</p>
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
        {busy === "upload" && <p className="text-sm">Uploading and reading...</p>}
        <ul className="flex flex-col gap-2">
          {files.length === 0 && <li className="text-sm text-zinc-500">No documents yet.</li>}
          {files.map((f) => (
            <li key={f.id} className="flex items-center gap-2 text-sm">
              <a href={`/api/files/${f.id}`} className="break-all underline">{f.filename}</a>
              <button className="ml-auto text-xs text-red-600 underline" disabled={!!busy} onClick={() => void removeFile(f.id)}>Remove</button>
            </li>
          ))}
        </ul>
      </section>

      <section className={card}>
        <h2 className="text-lg font-semibold">What Clutter understands about you</h2>
        <p className="text-sm text-zinc-600 dark:text-zinc-400">
          Built only from what you gave it and, if learning is on, what you said. Clutter uses this to ground its questions and
          only encourages you where your own work backs it up.
        </p>
        <pre className="whitespace-pre-wrap font-sans text-sm">{profile.understanding ?? "Nothing yet. Add an intro, links or documents."}</pre>
        <button className="self-start text-sm underline" disabled={!!busy} onClick={() => void refresh()}>
          {busy === "refresh" ? "Updating..." : "Update now"}
        </button>

        <h3 className="mt-2 font-semibold">Learned from your conversations</h3>
        <ul className="flex flex-col gap-2">
          {facts.length === 0 && <li className="text-sm text-zinc-500">Nothing learned yet.</li>}
          {facts.map((f) => (
            <li key={f.id} className="flex items-start gap-2 text-sm">
              <span>{f.fact}</span>
              <button className="ml-auto shrink-0 text-xs text-red-600 underline" disabled={!!busy} onClick={() => void removeFact(f.id)}>Forget</button>
            </li>
          ))}
        </ul>

        <LearningToggle enabled={profile.learningEnabled} onChange={setLearning} />
      </section>
    </div>
  );
}
