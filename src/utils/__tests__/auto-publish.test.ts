import { describe, it, expect, vi } from "vitest";
import { runAutoPublish } from "../auto-publish";
import type { Brand, BrandChannel, ContentItem, PlatformDef } from "@/types";

const devtoDef: PlatformDef = {
  id: "devto",
  name: "Dev.to",
  icon: "",
  color: "#0a0a0a",
  bg: "#fff",
  desc: "Test def",
  fields: [{ key: "apiKey", label: "API Key", placeholder: "" }],
  guide: { title: "t", steps: [] },
};

function makeItem(overrides: Partial<ContentItem> = {}): ContentItem {
  return {
    id: 1,
    brand: "FakeCo",
    brandColor: "#000",
    campaign: "Campaign",
    pillar: "Education",
    platform: "Dev.to",
    status: "scheduled",
    caption: "Hello world",
    hashtags: "#dev #test",
    scheduled: "Sep 20, 2026 — 9:00 AM",
    scheduledISO: "2026-09-20T09:00:00",
    format: "Article",
    score: 80,
    ...overrides,
  };
}

function connectedChannel(): BrandChannel {
  return { platformId: "devto", connected: true, config: { apiKey: "fake-key" } };
}

function makeBrand(id: number, name: string, channels: BrandChannel[]): Brand {
  return {
    id, name, industry: "SaaS", color: "#000", tagline: "", tone: [], audience: "",
    pillars: [], platforms: ["Dev.to"], channels,
    ideas: 0, drafts: 0, review: 0, scheduled: 0, posts_month: 0,
  };
}

const NOW = new Date("2026-09-24T12:00:00");

function handlers(channel: BrandChannel | null, publish = vi.fn()) {
  return {
    findChannel: () => channel,
    findDef: (ch: BrandChannel) => (ch.platformId === "devto" ? devtoDef : null),
    publish,
    onPublished: vi.fn(),
    onFailed: vi.fn(),
  };
}

describe("runAutoPublish", () => {
  it("publishes a due post with a connected channel", async () => {
    const publish = vi.fn().mockResolvedValue({ success: true, message: "Published" });
    const brand = makeBrand(1, "FakeCo", [connectedChannel()]);
    const { onPublished } = handlers(brand.channels[0]!, publish);

    const report = await runAutoPublish(
      [makeItem()],
      NOW,
      new Set(),
      { findChannel: () => brand.channels[0]!, findDef: handlers(brand.channels[0]!).findDef, publish, onPublished, onFailed: vi.fn() },
    );

    expect(publish).toHaveBeenCalledTimes(1);
    expect(publish).toHaveBeenCalledWith(
      expect.objectContaining({ id: 1, brand: "FakeCo", platform: "Dev.to" }),
      brand.channels[0],
      devtoDef,
    );
    expect(onPublished).toHaveBeenCalledWith(expect.objectContaining({ id: 1 }), devtoDef);
    expect(report.published).toEqual([1]);
  });

  it("publishes oldest due first", async () => {
    const publish = vi.fn().mockResolvedValue({ success: true, message: "ok" });
    const brand = makeBrand(1, "FakeCo", [connectedChannel()]);
    const items = [
      makeItem({ id: 3, scheduledISO: "2026-09-24T11:00:00" }),
      makeItem({ id: 1, scheduledISO: "2026-09-20T09:00:00" }),
      makeItem({ id: 2, scheduledISO: "2026-09-24T10:00:00" }),
    ];
    const report = await runAutoPublish(items, NOW, new Set(), {
      findChannel: () => brand.channels[0]!,
      findDef: () => devtoDef,
      publish, onPublished: vi.fn(), onFailed: vi.fn(),
    });
    const order = publish.mock.calls.map(c => (c[0] as ContentItem).id);
    expect(order).toEqual([1, 2, 3]);
    expect(report.published).toEqual([1, 2, 3]);
  });

  it("skips a due post whose brand has no connected channel", async () => {
    const publish = vi.fn();
    const { onFailed } = handlers(null, publish);
    const report = await runAutoPublish([makeItem()], NOW, new Set(), {
      findChannel: () => null,
      findDef: () => devtoDef,
      publish, onPublished: vi.fn(), onFailed,
    });
    expect(publish).not.toHaveBeenCalled();
    expect(onFailed).not.toHaveBeenCalled();
    expect(report.published).toEqual([]);
    expect(report.skipped).toEqual([1]);
  });

  it("skips posts not due yet", async () => {
    const publish = vi.fn();
    const brand = makeBrand(1, "FakeCo", [connectedChannel()]);
    const future = makeItem({ id: 99, scheduledISO: "2026-09-25T09:00:00" });
    const report = await runAutoPublish([future], NOW, new Set(), {
      findChannel: () => brand.channels[0]!,
      findDef: () => devtoDef,
      publish, onPublished: vi.fn(), onFailed: vi.fn(),
    });
    expect(publish).not.toHaveBeenCalled();
    expect(report.published).toEqual([]);
  });

  it("does not republish posts already in flight", async () => {
    const publish = vi.fn().mockResolvedValue({ success: true, message: "ok" });
    const brand = makeBrand(1, "FakeCo", [connectedChannel()]);
    const inFlight = new Set<number>([1]);
    const report = await runAutoPublish([makeItem()], NOW, inFlight, {
      findChannel: () => brand.channels[0]!,
      findDef: () => devtoDef,
      publish, onPublished: vi.fn(), onFailed: vi.fn(),
    });
    expect(publish).not.toHaveBeenCalled();
    expect(report.published).toEqual([]);
    expect(report.skipped.length).toBe(0);
  });

  it("clears in-flight after completion so the next tick can republish", async () => {
    const publish = vi.fn().mockResolvedValue({ success: true, message: "ok" });
    const brand = makeBrand(1, "FakeCo", [connectedChannel()]);
    const inFlight = new Set<number>();
    const report = await runAutoPublish([makeItem()], NOW, inFlight, {
      findChannel: () => brand.channels[0]!,
      findDef: () => devtoDef,
      publish, onPublished: vi.fn(), onFailed: vi.fn(),
    });
    expect(report.published).toEqual([1]);
    expect(inFlight.has(1)).toBe(false);
  });

  it("reports failed publishes and does not flip status", async () => {
    const publish = vi.fn().mockResolvedValue({ success: false, message: "HTTP 500" });
    const brand = makeBrand(1, "FakeCo", [connectedChannel()]);
    const onPublished = vi.fn();
    const onFailed = vi.fn();
    const report = await runAutoPublish([makeItem()], NOW, new Set(), {
      findChannel: () => brand.channels[0]!,
      findDef: () => devtoDef,
      publish, onPublished, onFailed,
    });
    expect(publish).toHaveBeenCalledTimes(1);
    expect(onPublished).not.toHaveBeenCalled();
    expect(onFailed).toHaveBeenCalledWith(expect.objectContaining({ id: 1 }), devtoDef, "HTTP 500");
    expect(report.failed).toEqual([{ id: 1, message: "HTTP 500" }]);
    expect(report.published).toEqual([]);
  });

  it("stops early when cancelled", async () => {
    const publish = vi.fn().mockResolvedValue({ success: true, message: "ok" });
    const brand = makeBrand(1, "FakeCo", [connectedChannel()]);
    let cancelled = false;
    const report = await runAutoPublish(
      [makeItem({ id: 1 }), makeItem({ id: 2 }), makeItem({ id: 3 })],
      NOW,
      new Set(),
      {
        findChannel: () => brand.channels[0]!,
        findDef: () => devtoDef,
        publish,
        onPublished: () => { cancelled = true; },
        onFailed: vi.fn(),
        isCancelled: () => cancelled,
      },
    );
    expect(publish.mock.calls.map(c => (c[0] as ContentItem).id)).toEqual([1]);
    expect(report.published).toEqual([1]);
  });
});