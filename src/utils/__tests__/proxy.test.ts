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
  it("contains 7 platforms", () => {
    expect(PROXY_REQUIRED_PLATFORMS.size).toBe(7);
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
});
