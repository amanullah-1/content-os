import { describe, it, expect } from "vitest";
import { parseScheduledDate, dateKey, addDays, getWeekStart } from "../calendar-helpers";
import type { ContentItem } from "@/types";

function makeItem(overrides: Partial<ContentItem> = {}): ContentItem {
  return {
    id: 1,
    brand: "Test",
    brandColor: "#000",
    campaign: "",
    pillar: "",
    platform: "",
    status: "draft",
    caption: "",
    hashtags: "",
    scheduled: "",
    format: "",
    imagePrompt: "",
    videoScript: "",
    generatedImageUrl: "",
    generatedVideoUrl: "",
    score: 0,
    ...overrides,
  };
}

describe("parseScheduledDate", () => {
  it("returns null when no scheduled date", () => {
    expect(parseScheduledDate(makeItem())).toBeNull();
  });

  it("parses scheduledISO", () => {
    const item = makeItem({ scheduledISO: "2026-09-15T10:30:00Z" });
    const result = parseScheduledDate(item);
    expect(result).toBeInstanceOf(Date);
    expect(result!.getFullYear()).toBe(2026);
  });

  it("parses scheduled string with em dash", () => {
    const item = makeItem({ scheduled: "Sep 15, 2026 — 7:30 PM" });
    const result = parseScheduledDate(item);
    expect(result).toBeInstanceOf(Date);
  });

  it("parses scheduled string without em dash", () => {
    const item = makeItem({ scheduled: "Sep 15, 2026 7:30 PM" });
    const result = parseScheduledDate(item);
    expect(result).toBeInstanceOf(Date);
  });

  it("returns null for invalid date string", () => {
    const item = makeItem({ scheduled: "not a date" });
    expect(parseScheduledDate(item)).toBeNull();
  });

  it("returns null for invalid scheduledISO", () => {
    const item = makeItem({ scheduledISO: "invalid" });
    expect(parseScheduledDate(item)).toBeNull();
  });

  it("prefers scheduledISO over scheduled", () => {
    const item = makeItem({
      scheduledISO: "2026-01-01T00:00:00Z",
      scheduled: "Jul 4, 2026",
    });
    const result = parseScheduledDate(item);
    expect(result!.getFullYear()).toBe(2026);
    expect(result!.getMonth()).toBe(0); // January, not July
  });
});

describe("dateKey", () => {
  it("formats date as YYYY-MM-DD", () => {
    const d = new Date(2026, 8, 15); // Sep 15, 2026
    expect(dateKey(d)).toBe("2026-09-15");
  });

  it("pads single-digit month and day", () => {
    const d = new Date(2026, 0, 5); // Jan 5, 2026
    expect(dateKey(d)).toBe("2026-01-05");
  });
});

describe("addDays", () => {
  it("adds days correctly", () => {
    const d = new Date(2026, 8, 1); // Sep 1
    const result = addDays(d, 10);
    expect(result.getDate()).toBe(11);
  });

  it("rolls over months", () => {
    const d = new Date(2026, 8, 25); // Sep 25
    const result = addDays(d, 10); // Oct 5
    expect(result.getMonth()).toBe(9); // October
    expect(result.getDate()).toBe(5);
  });

  it("handles negative days", () => {
    const d = new Date(2026, 8, 10); // Sep 10
    const result = addDays(d, -5);
    expect(result.getDate()).toBe(5);
  });
});

describe("getWeekStart", () => {
  it("returns Monday for a Wednesday", () => {
    const d = new Date(2026, 8, 2); // Sep 2, 2026 — Wednesday
    const start = getWeekStart(d);
    expect(start.getDay()).toBe(1); // Monday
    expect(start.getDate()).toBe(31); // Aug 31
  });

  it("returns same day if Monday", () => {
    const d = new Date(2026, 8, 7); // Sep 7, 2026 — Monday
    const start = getWeekStart(d);
    expect(start.getDay()).toBe(1);
    expect(start.getDate()).toBe(7);
  });

  it("returns previous Monday if Sunday", () => {
    const d = new Date(2026, 8, 6); // Sep 6, 2026 — Sunday
    const start = getWeekStart(d);
    expect(start.getDay()).toBe(1);
    expect(start.getDate()).toBe(31); // Aug 31
  });
});
