import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  proxyPublish,
  shouldUseProxy,
  PROXY_REQUIRED_PLATFORMS,
  DIRECT_PLATFORMS,
} from "../proxy";

describe("shouldUseProxy", () => {
  it("returns true for CORS-blocked platforms", () => {
    expect(shouldUseProxy("facebook")).toBe(true);
    expect(shouldUseProxy("instagram")).toBe(true);
    expect(shouldUseProxy("linkedin")).toBe(true);
    expect(shouldUseProxy("woocommerce")).toBe(true);
    expect(shouldUseProxy("tiktok")).toBe(true);
    expect(shouldUseProxy("youtube")).toBe(true);
    expect(shouldUseProxy("pinterest")).toBe(true);
    expect(shouldUseProxy("x")).toBe(true);
  });

  it("returns false for direct platforms", () => {
    expect(shouldUseProxy("devto")).toBe(false);
  });

  it("returns false for unknown platforms", () => {
    expect(shouldUseProxy("twitter")).toBe(false);
    expect(shouldUseProxy("unknown")).toBe(false);
  });
});

describe("PROXY_REQUIRED_PLATFORMS", () => {
  it("contains 8 platforms", () => {
    expect(PROXY_REQUIRED_PLATFORMS.size).toBe(8);
    expect(PROXY_REQUIRED_PLATFORMS.has("x")).toBe(true);
  });
});

describe("DIRECT_PLATFORMS", () => {
  it("contains devto", () => {
    expect(DIRECT_PLATFORMS.has("devto")).toBe(true);
  });
});

describe("proxyPublish", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  const payload = {
    platform: "facebook",
    config: { accessToken: "tok", pageId: "123" },
    content: { caption: "Hello", hashtags: "#test" },
  };

  it("returns success on 200 response", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ success: true, message: "Published to Facebook" }),
    }));

    const result = await proxyPublish(payload);
    expect(result).toEqual({ success: true, message: "Published to Facebook" });
  });

  it("returns error on non-200 response", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: false,
      status: 500,
      text: () => Promise.resolve("Internal Server Error"),
    }));

    const result = await proxyPublish(payload);
    expect(result.success).toBe(false);
    expect(result.message).toContain("500");
  });

  it("returns error on network failure", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("Failed to fetch")));

    const result = await proxyPublish(payload);
    expect(result.success).toBe(false);
    expect(result.message).toContain("Proxy unreachable");
    expect(result.message).toContain("Failed to fetch");
  });

  it("returns error when fetch throws non-Error", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue("string error"));

    const result = await proxyPublish(payload);
    expect(result.success).toBe(false);
    expect(result.message).toContain("Network error");
  });

  it("surfaces deduplicated so the UI can tell a skip from a real send", async () => {
    // The proxy answers a repeated send with success plus the *original* post's
    // id and timestamp. Without this flag the caller reports "Published" for a
    // request that never reached the platform.
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({
        success: true,
        message: "Already published - skipped a duplicate send.",
        external_id: "PAGE_OLD",
        published_at: "2026-09-28T05:36:53+00:00",
        deduplicated: true,
      }),
    }));

    const result = await proxyPublish(payload);
    expect(result.deduplicated).toBe(true);
    expect(result.success).toBe(true);
    expect(result.external_id).toBe("PAGE_OLD");
  });

  it("leaves deduplicated undefined for a genuine publish", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({
        success: true,
        message: "Published to Facebook - Post 123",
        external_id: "123",
        published_at: "2026-09-28T06:00:00+00:00",
      }),
    }));

    const result = await proxyPublish(payload);
    expect(result.deduplicated).toBeUndefined();
  });
});
