import "server-only";
import { outputText, respond, xaiFetch, xaiModels, type InputMessage } from "@/lib/xai";

const TEXT_TYPES = /^(text\/|application\/(json|xml|x-yaml|markdown))/;
const DOCX = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
const IMAGE_TYPES = /^image\/(png|jpeg|webp)$/;
const PDF = "application/pdf";

const INSTRUCTION =
  "Transcribe all text in this file verbatim. For images or figures, describe only what is visibly there. " +
  "Do not add opinions, suggestions or anything not in the file.";

// Pulls the text out of an uploaded file. Grok only transcribes or describes
// what is there; it adds nothing of its own (no-ghost policy).
export async function extractText(data: ArrayBuffer, mimeType: string, filename = "upload"): Promise<string | null> {
  if (TEXT_TYPES.test(mimeType)) return new TextDecoder().decode(data);
  if (mimeType === DOCX) {
    const mammoth = await import("mammoth");
    const { value } = await mammoth.extractRawText({ buffer: Buffer.from(data) });
    return value.trim() || null;
  }
  if (IMAGE_TYPES.test(mimeType)) {
    const image_url = `data:${mimeType};base64,${Buffer.from(data).toString("base64")}`;
    return ask([{ type: "input_image", image_url }, { type: "input_text", text: INSTRUCTION }]);
  }
  if (mimeType !== PDF) return null;

  // PDFs go through xAI's Files API: upload, read, then delete straight away
  // (the hour-long expiry is only a backstop if the delete fails).
  const form = new FormData();
  form.append("expires_after", "3600");
  form.append("purpose", "assistants");
  form.append("file", new Blob([data], { type: PDF }), filename);
  const { id } = (await (await xaiFetch("/files", { method: "POST", body: form })).json()) as { id: string };
  try {
    return await ask([{ type: "input_file", file_id: id }, { type: "input_text", text: INSTRUCTION }]);
  } finally {
    await xaiFetch(`/files/${encodeURIComponent(id)}`, { method: "DELETE" }).catch((err) =>
      console.error("Deleting the uploaded file from xAI failed", err),
    );
  }
}

async function ask(content: Exclude<InputMessage["content"], string>): Promise<string | null> {
  const res = await respond({ model: xaiModels.text, input: [{ role: "user", content }] });
  return outputText(res) || null;
}
