"use client";

import { useEffect, useRef, useState } from "react";

// Adobe Express Embed SDK: opens the full Express editor over the page. When the
// user presses "Save to BrainStorm", the design comes back as an image and is
// handed to onDesign, which uploads it like any other document.
// The client id is public by design (Adobe locks it to the allowed domains set
// in the Developer Console), and APP_NAME must match the credential's Public App Name.
const CLIENT_ID = process.env.NEXT_PUBLIC_ADOBE_EXPRESS_CLIENT_ID;
const APP_NAME = process.env.NEXT_PUBLIC_ADOBE_EXPRESS_APP_NAME || "BrainStorm";
const SDK_URL = "https://cc-embed.adobe.com/sdk/v4/CCEverywhere.js";

type PublishParams = { asset?: { data: string | Blob; fileType?: string }[] };
type Editor = {
  create: (docConfig: object, appConfig: object, exportConfig: object[]) => void;
};
type CCEverywhere = {
  initialize: (hostInfo: { clientId: string; appName: string }, configParams?: object) => Promise<{ editor: Editor }>;
};
declare global {
  interface Window {
    CCEverywhere?: CCEverywhere;
  }
}

// initialize() may only run once per page, so keep the promise around.
let ready: Promise<Editor> | null = null;

function loadEditor(clientId: string): Promise<Editor> {
  ready ??= new Promise<void>((resolve, reject) => {
    if (window.CCEverywhere) return resolve();
    const s = document.createElement("script");
    s.src = SDK_URL;
    s.async = true;
    s.onload = () => resolve();
    s.onerror = () => reject(new Error("Couldn't load Adobe Express. Check your connection and try again."));
    document.head.appendChild(s);
  })
    .then(() => window.CCEverywhere!.initialize({ clientId, appName: APP_NAME }, { loginMode: "delayed" }))
    .then((sdk) => sdk.editor)
    .catch((err) => {
      ready = null;
      throw err;
    });
  return ready;
}

// The editor is added to <body> on top of the page, but the frosted nav and
// panels still showed through it. While it's open, hide everything that was
// on the page before it (only once Adobe has actually added its own nodes),
// and bring the page back once Adobe's nodes are removed or no longer shown,
// or when the returned restore() is called.
function coverPage(onRestored: () => void): () => void {
  const before = new Set(Array.from(document.body.children));
  const added = new Set<Element>();
  const hidden: HTMLElement[] = [];
  let done = false;
  let seen = false;
  const restore = () => {
    if (done) return;
    done = true;
    observer.disconnect();
    clearInterval(timer);
    for (const el of hidden.splice(0)) {
      el.style.removeProperty("visibility");
      el.inert = false;
    }
    onRestored();
  };
  const hide = () => {
    for (const el of before) {
      if (el instanceof HTMLElement && el.tagName !== "SCRIPT" && el.isConnected) {
        el.style.visibility = "hidden";
        el.inert = true;
        hidden.push(el);
      }
    }
  };
  const observer = new MutationObserver((records) => {
    for (const r of records) {
      r.addedNodes.forEach((n) => n instanceof Element && !before.has(n) && added.add(n));
      r.removedNodes.forEach((n) => n instanceof Element && added.delete(n));
    }
    if (added.size > 0 && hidden.length === 0) hide();
  });
  observer.observe(document.body, { childList: true });
  // Adobe may hide its editor rather than remove it, so also check it's still on screen.
  const timer = setInterval(() => {
    if (hidden.length === 0) return;
    const showing = Array.from(added).some((el) => el.isConnected && el.getClientRects().length > 0);
    if (showing) seen = true;
    else if (seen) restore();
  }, 500);
  return restore;
}

const extFor = (type: string) => (type.includes("jpeg") ? "jpg" : type.split("/")[1] || "png");

export function AdobeExpressButton({
  disabled, onDesign, onError,
}: {
  disabled?: boolean;
  onDesign: (file: File) => void;
  onError: (err: unknown) => void;
}) {
  const [opening, setOpening] = useState(false);
  // True from opening the editor until it closes; Adobe refuses a second create meanwhile.
  const [editing, setEditing] = useState(false);
  // Callbacks are captured when the editor opens; read the latest handlers through a ref.
  const handlers = useRef({ onDesign, onError });
  useEffect(() => {
    handlers.current = { onDesign, onError };
  });

  if (!CLIENT_ID) return null;

  const open = async () => {
    setOpening(true);
    let closed = () => setEditing(false);
    try {
      const editor = await loadEditor(CLIENT_ID);
      setEditing(true);
      closed = coverPage(() => setEditing(false));
      editor.create(
        {},
        {
          callbacks: {
            onCancel: closed,
            onError: (err: unknown) => {
              closed();
              handlers.current.onError(new Error(`Adobe Express: ${String(err)}`));
            },
            // The editor may stay open after saving; coverPage notices when it closes.
            onPublish: async (_intent: unknown, params: PublishParams) => {
              try {
                const asset = params.asset?.[0];
                if (!asset) throw new Error("Adobe Express didn't send a design back.");
                const blob = typeof asset.data === "string" ? await (await fetch(asset.data)).blob() : asset.data;
                const type = asset.fileType || blob.type || "image/png";
                const stamp = new Date().toISOString().slice(0, 16).replace("T", " ").replace(":", "-");
                handlers.current.onDesign(new File([blob], `Adobe Express design ${stamp}.${extFor(type)}`, { type }));
              } catch (err) {
                handlers.current.onError(err);
              }
            },
          },
        },
        [
          { id: "save-to-brainstorm", label: "Save to BrainStorm", action: { target: "publish" }, style: { uiType: "button" } },
          { id: "download", label: "Download", action: { target: "download" }, style: { uiType: "button" } },
        ],
      );
    } catch (err) {
      closed();
      handlers.current.onError(err);
    } finally {
      setOpening(false);
    }
  };

  return (
    <button type="button" className="c-btn" style={{ marginTop: 8 }} disabled={disabled || opening || editing} onClick={() => void open()}>
      {opening ? "Opening Adobe Express..." : "Design in Adobe Express"}
    </button>
  );
}
