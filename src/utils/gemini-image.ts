// Google Gemini ("Nano Banana") image generation — pure helpers.
//
// The network call lives in App.tsx alongside the other image providers so it
// follows the same client-side fetch pattern. Everything that can be reasoned
// about without a network round-trip lives here so it can be unit-tested.
//
// Docs verified 2026-09-28:
//   https://ai.google.dev/gemini-api/docs/image-generation
//   POST https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent
//   Auth via the `x-goog-api-key` header, response is base64 inline image data.
//
// Model ids are the GA ones. `gemini-3.1-flash-image-preview` and
// `gemini-3-pro-image-preview` were shut down 2026-06-25, and
// `gemini-2.5-flash-image` is scheduled for shutdown 2026-10-02, so none of
// those are offered here. See GEMINI_IMAGE_MODELS below.

export const GEMINI_API_BASE = "https://generativelanguage.googleapis.com/v1beta/models";

export interface GeminiImageModel {
  id: string;
  label: string;
  desc: string;
  /** Highest tier the model accepts in `imageConfig.imageSize`. */
  maxSize: "1K" | "2K" | "4K";
}

export const GEMINI_IMAGE_MODELS: GeminiImageModel[] = [
  { id: "gemini-3.1-flash-image", label: "Nano Banana 2", desc: "Fast, versatile — best default", maxSize: "4K" },
  { id: "gemini-3-pro-image",    label: "Nano Banana Pro", desc: "Highest quality, slower",  maxSize: "4K" },
];

export const DEFAULT_GEMINI_IMAGE_MODEL = "gemini-3.1-flash-image";

export function resolveGeminiModel(model?: string): GeminiImageModel {
  const id = model?.trim();
  return GEMINI_IMAGE_MODELS.find(m => m.id === id) ?? GEMINI_IMAGE_MODELS[0];
}

/** Content formats the rest of the app already treats as landscape. */
const LANDSCAPE_FORMATS = new Set(["Image", "Carousel", "Story"]);

/**
 * Mirrors the orientation rule the other providers use in App.tsx
 * (generateImagePollinations): landscape formats get 4:3, everything else 3:4.
 * Deliberately the same rule rather than a "better" one, so switching provider
 * never changes the orientation a post was composed for.
 */
export function geminiAspectRatio(format: string): "4:3" | "3:4" {
  return LANDSCAPE_FORMATS.has(format) ? "4:3" : "3:4";
}

const SIZES = ["1K", "2K", "4K"] as const;
export type GeminiImageSize = (typeof SIZES)[number];

/**
 * Clamps a requested resolution to what the model actually supports.
 * `gemini-3.1-flash-lite-image` is 1K-only, so a shared 4K setting would be
 * rejected wholesale rather than downgraded by Google.
 */
export function resolveGeminiSize(model: GeminiImageModel, requested?: string): GeminiImageSize {
  const want = (requested || "").trim().toUpperCase();
  if (!want || !SIZES.includes(want as GeminiImageSize)) return "1K";
  const allowed = SIZES.filter(s => SIZES.indexOf(s) <= SIZES.indexOf(model.maxSize));
  return allowed.includes(want as GeminiImageSize) ? (want as GeminiImageSize) : "1K";
}

export interface GeminiInlineImage {
  mimeType: string;
  /** base64-encoded, no data: prefix. */
  data: string;
}

interface GeminiBlob {
  mimeType?: string;
  mime_type?: string;
  data?: string;
}

interface GeminiPart {
  text?: string;
  inlineData?: GeminiBlob;
  inline_data?: GeminiBlob;
  /** True on the model's intermediate "thinking" images. */
  thought?: boolean;
  thoughtSignature?: string;
}

interface GeminiCandidate {
  content?: { parts?: GeminiPart[] };
  finishReason?: string;
}

interface GeminiResponse {
  candidates?: GeminiCandidate[];
  promptFeedback?: { blockReason?: string };
  error?: { message?: string };
}

function partImage(part: GeminiPart): GeminiInlineImage | null {
  // Google's REST responses use camelCase, but the same payload has shipped
  // snake_case in some v1beta examples, so accept either.
  const d = part.inlineData ?? part.inline_data;
  if (!d || typeof d.data !== "string" || !d.data) return null;
  const mimeType = d.mimeType ?? d.mime_type ?? "image/png";
  return { mimeType, data: d.data };
}

/**
 * Pulls the final image out of a generateContent response.
 *
 * Gemini 3 image models are thinking models: they emit up to two *interim*
 * images while reasoning, then the real one. Those interim parts are flagged
 * `thought: true`, and picking the wrong one silently returns a draft sketch
 * instead of the finished image. Interim parts are dropped and the last
 * remaining image wins.
 *
 * Returns null rather than throwing on anything unexpected — the caller turns
 * that into a message aimed at the person holding the API key.
 */
export function extractGeminiImage(payload: unknown): GeminiInlineImage | null {
  if (!payload || typeof payload !== "object") return null;
  const res = payload as GeminiResponse;
  const candidates = Array.isArray(res.candidates) ? res.candidates : [];
  for (const candidate of candidates) {
    const parts = Array.isArray(candidate?.content?.parts) ? candidate.content.parts : [];
    const finished: GeminiInlineImage[] = [];
    for (const part of parts) {
      if (!part || typeof part !== "object") continue;
      if (part.thought === true) continue;
      const img = partImage(part);
      if (img) finished.push(img);
    }
    if (finished.length) return finished[finished.length - 1];
  }
  return null;
}

/**
 * Best-effort explanation when no image came back, so the failure is
 * actionable instead of "no image in response".
 */
export function explainGeminiFailure(payload: unknown): string {
  if (!payload || typeof payload !== "object") return "Gemini returned an unreadable response.";
  const res = payload as GeminiResponse;
  const blocked = res.promptFeedback?.blockReason;
  if (blocked) return `Gemini blocked this prompt (${blocked}). Rephrase it and try again.`;
  const apiError = res.error?.message;
  if (apiError) return `Gemini error: ${apiError}`;
  const reason = res.candidates?.[0]?.finishReason;
  if (reason && reason !== "STOP") return `Gemini stopped early (${reason}) — the prompt may have been filtered.`;
  return "Gemini returned no image. Try rephrasing the prompt.";
}
