import "server-only";
import { geminiModels, getGemini } from "@/lib/gemini";

const TEXT_TYPES = /^(text\/|application\/(json|xml|x-yaml|markdown))/;
const DOCX = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
const GEMINI_TYPES = /^(application\/pdf|image\/(png|jpeg|webp|heic|heif))$/;

// Pulls the text out of an uploaded file. Gemini only transcribes or
// describes what is there; it adds nothing of its own (no-ghost policy).
export async function extractText(data: ArrayBuffer, mimeType: string): Promise<string | null> {
  if (TEXT_TYPES.test(mimeType)) return new TextDecoder().decode(data);
  if (mimeType === DOCX) {
    const mammoth = await import("mammoth");
    const { value } = await mammoth.extractRawText({ buffer: Buffer.from(data) });
    return value.trim() || null;
  }
  if (!GEMINI_TYPES.test(mimeType)) return null;
  const res = await getGemini().models.generateContent({
    model: geminiModels.flash,
    contents: [
      {
        role: "user",
        parts: [
          { inlineData: { mimeType, data: Buffer.from(data).toString("base64") } },
          {
            text:
              "Transcribe all text in this file verbatim. For images or figures, describe only what is visibly there. " +
              "Do not add opinions, suggestions or anything not in the file.",
          },
        ],
      },
    ],
  });
  return res.text?.trim() || null;
}
