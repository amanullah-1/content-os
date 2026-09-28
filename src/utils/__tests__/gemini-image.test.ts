import { describe, it, expect } from "vitest";
import {
  GEMINI_IMAGE_MODELS,
  DEFAULT_GEMINI_IMAGE_MODEL,
  resolveGeminiModel,
  resolveGeminiSize,
  geminiAspectRatio,
  extractGeminiImage,
  explainGeminiFailure,
} from "../gemini-image";

const B64_A = "QUFBQQ==";
const B64_B = "QkJCQg==";

describe("resolveGeminiModel", () => {
  it("resolves a known model id", () => {
    expect(resolveGeminiModel("gemini-3-pro-image").id).toBe("gemini-3-pro-image");
  });

  it("falls back to the default for unknown, blank or missing ids", () => {
    expect(resolveGeminiModel(undefined).id).toBe(DEFAULT_GEMINI_IMAGE_MODEL);
    expect(resolveGeminiModel("").id).toBe(DEFAULT_GEMINI_IMAGE_MODEL);
    expect(resolveGeminiModel("   ").id).toBe(DEFAULT_GEMINI_IMAGE_MODEL);
    expect(resolveGeminiModel("gemini-imagen-4.0-generate-001").id).toBe(DEFAULT_GEMINI_IMAGE_MODEL);
  });

  it("does not offer the shut-down or retiring model ids", () => {
    const ids = GEMINI_IMAGE_MODELS.map(m => m.id);
    expect(ids).not.toContain("gemini-3.1-flash-image-preview");
    expect(ids).not.toContain("gemini-3-pro-image-preview");
    expect(ids).not.toContain("gemini-2.5-flash-image");
  });

  it("trims surrounding whitespace off a pasted id", () => {
    expect(resolveGeminiModel("  gemini-3-pro-image  ").id).toBe("gemini-3-pro-image");
  });
});

describe("geminiAspectRatio", () => {
  it("treats the app's landscape formats as 4:3", () => {
    expect(geminiAspectRatio("Image")).toBe("4:3");
    expect(geminiAspectRatio("Carousel")).toBe("4:3");
    expect(geminiAspectRatio("Story")).toBe("4:3");
  });

  it("treats everything else as 3:4", () => {
    expect(geminiAspectRatio("Post")).toBe("3:4");
    expect(geminiAspectRatio("Reel")).toBe("3:4");
    expect(geminiAspectRatio("")).toBe("3:4");
  });

  it("matches the orientation rule the other providers already use", () => {
    const landscape = new Set(["Image", "Carousel", "Story"]);
    for (const f of ["Image", "Carousel", "Story", "Post", "Reel", "Short"]) {
      const expected = landscape.has(f) ? "4:3" : "3:4";
      expect(geminiAspectRatio(f)).toBe(expected);
    }
  });
});

describe("resolveGeminiSize", () => {
  const flash = resolveGeminiModel("gemini-3.1-flash-image");
  const pro = resolveGeminiModel("gemini-3-pro-image");

  it("defaults to 1K when nothing is requested", () => {
    expect(resolveGeminiSize(flash)).toBe("1K");
    expect(resolveGeminiSize(flash, "")).toBe("1K");
    expect(resolveGeminiSize(flash, "  ")).toBe("1K");
  });

  it("accepts the tiers the model supports", () => {
    expect(resolveGeminiSize(flash, "2K")).toBe("2K");
    expect(resolveGeminiSize(pro, "4K")).toBe("4K");
  });

  it("normalises case and whitespace", () => {
    expect(resolveGeminiSize(flash, " 2k ")).toBe("2K");
  });

  it("rejects unknown sizes down to the safe default", () => {
    expect(resolveGeminiSize(flash, "8K")).toBe("1K");
    expect(resolveGeminiSize(flash, "512px")).toBe("1K");
    expect(resolveGeminiSize(flash, "huge")).toBe("1K");
  });
});

describe("extractGeminiImage", () => {
  it("reads a single inline image", () => {
    const img = extractGeminiImage({
      candidates: [{ content: { parts: [{ inlineData: { mimeType: "image/png", data: B64_A } }] }, finishReason: "STOP" }],
    });
    expect(img).toEqual({ mimeType: "image/png", data: B64_A });
  });

  it("skips the model's interim thought images and returns the final one", () => {
    const payload = {
      candidates: [{
        content: {
          parts: [
            { text: "Let me think about the composition..." },
            { inlineData: { mimeType: "image/png", data: B64_A }, thought: true },
            { inlineData: { mimeType: "image/png", data: B64_B }, thought: true },
            { inlineData: { mimeType: "image/png", data: "Q0NDQw==" } },
          ],
        },
        finishReason: "STOP",
      }],
    };
    expect(extractGeminiImage(payload)?.data).toBe("Q0NDQw==");
  });

  it("keeps the last real image when several are returned unflagged", () => {
    const payload = {
      candidates: [{
        content: {
          parts: [
            { inlineData: { mimeType: "image/png", data: B64_A } },
            { inlineData: { mimeType: "image/jpeg", data: B64_B } },
          ],
        },
      }],
    };
    expect(extractGeminiImage(payload)).toEqual({ mimeType: "image/jpeg", data: B64_B });
  });

  it("falls back to the last candidate when the first has no image", () => {
    const payload = {
      candidates: [
        { content: { parts: [{ text: "no image here" }] }, finishReason: "SAFETY" },
        { content: { parts: [{ inlineData: { mimeType: "image/png", data: B64_B } }] }, finishReason: "STOP" },
      ],
    };
    expect(extractGeminiImage(payload)?.data).toBe(B64_B);
  });

  it("accepts snake_case inline_data as well as camelCase", () => {
    const payload = {
      candidates: [{ content: { parts: [{ inline_data: { mime_type: "image/webp", data: B64_A } }] } }],
    };
    expect(extractGeminiImage(payload)).toEqual({ mimeType: "image/webp", data: B64_A });
  });

  it("defaults the mime type when the API omits it", () => {
    const payload = { candidates: [{ content: { parts: [{ inlineData: { data: B64_A } }] } }] };
    expect(extractGeminiImage(payload)?.mimeType).toBe("image/png");
  });

  it("returns null for text-only, empty and malformed payloads", () => {
    expect(extractGeminiImage({ candidates: [{ content: { parts: [{ text: "sorry" }] } }] })).toBeNull();
    expect(extractGeminiImage({ candidates: [] })).toBeNull();
    expect(extractGeminiImage({})).toBeNull();
    expect(extractGeminiImage(null)).toBeNull();
    expect(extractGeminiImage(undefined)).toBeNull();
    expect(extractGeminiImage("nope")).toBeNull();
  });

  it("ignores parts with empty or missing data", () => {
    expect(extractGeminiImage({ candidates: [{ content: { parts: [{ inlineData: { mimeType: "image/png", data: "" } }] } }] })).toBeNull();
    expect(extractGeminiImage({ candidates: [{ content: { parts: [{ inlineData: {} }] } }] })).toBeNull();
    expect(extractGeminiImage({ candidates: [{ content: { parts: [null, undefined, 7] } }] })).toBeNull();
  });
});

describe("explainGeminiFailure", () => {
  it("names a safety block", () => {
    expect(explainGeminiFailure({ promptFeedback: { blockReason: "SAFETY" } })).toContain("SAFETY");
  });

  it("surfaces the API error message", () => {
    expect(explainGeminiFailure({ error: { message: "API key not valid" } })).toContain("API key not valid");
  });

  it("reports an abnormal finish reason", () => {
    expect(explainGeminiFailure({ candidates: [{ finishReason: "MAX_TOKENS" }] })).toContain("MAX_TOKENS");
  });

  it("falls back to a generic message", () => {
    expect(explainGeminiFailure({ candidates: [{ finishReason: "STOP" }] })).toContain("no image");
    expect(explainGeminiFailure(null)).toContain("unreadable");
  });
});
