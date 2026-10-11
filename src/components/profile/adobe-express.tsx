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

const extFor = (type: string) => (type.includes("jpeg") ? "jpg" : type.split("/")[1] || "png");

export function AdobeExpressButton({
  disabled, onDesign, onError,
}: {
  disabled?: boolean;
  onDesign: (file: File) => void;
  onError: (err: unknown) => void;
}) {
  const [opening, setOpening] = useState(false);
  // Callbacks are captured when the editor opens; read the latest handlers through a ref.
  const handlers = useRef({ onDesign, onError });
  useEffect(() => {
    handlers.current = { onDesign, onError };
  });

  if (!CLIENT_ID) return null;

  const open = async () => {
    setOpening(true);
    try {
      const editor = await loadEditor(CLIENT_ID);
      editor.create(
        {},
        {
          callbacks: {
            onCancel: () => {},
            onError: (err: unknown) => handlers.current.onError(new Error(`Adobe Express: ${String(err)}`)),
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
      handlers.current.onError(err);
    } finally {
      setOpening(false);
    }
  };

  return (
    <button type="button" className="c-btn" style={{ marginTop: 8 }} disabled={disabled || opening} onClick={() => void open()}>
      {opening ? "Opening Adobe Express..." : "Design in Adobe Express"}
    </button>
  );
}
