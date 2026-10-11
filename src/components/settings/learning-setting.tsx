"use client";

import { useEffect, useState } from "react";

import { LearningToggle } from "@/components/profile/learning-toggle";
import { Loading } from "@/components/loading";

// The learning switch on Settings; the same one sits on Profile.
export function LearningSetting() {
  const [enabled, setEnabled] = useState<boolean | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/profile")
      .then((r) => r.json())
      .then((p) => setEnabled(p && "learningEnabled" in p ? p.learningEnabled : true))
      .catch(() => setError("Couldn't load this setting."));
  }, []);

  async function change(v: boolean) {
    setError(null);
    const res = await fetch("/api/profile", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ learningEnabled: v }),
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) setError(body.error ?? `Saving failed (${res.status})`);
    else setEnabled(body.learningEnabled);
  }

  if (error && enabled === null) return <p className="c-status error">{error}</p>;
  if (enabled === null) return <Loading />;
  return (
    <>
      {error && <p className="c-status error">{error}</p>}
      <LearningToggle enabled={enabled} onChange={change} />
    </>
  );
}
