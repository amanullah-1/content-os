import { describe, it, expect } from "vitest";
import { parseScheduledDate, dateKey, addDays, getWeekStart, getDueScheduledPosts, formatScheduledLabel, toDatetimeLocalValue } from "../calendar-helpers";
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
    const item = makeItem({ scheduled: "Sep 15, 2026 - 7:30 PM" });
    const result = parseScheduledDate(item);
    expect(result).toBeInstanceOf(Date);
  });

  it("assumes the current year when the label has no year", () => {
    // Without this, "Sep 28 12:51 PM" parses as 2001-09-28 and the post looks
    // decades overdue.
    const item = makeItem({ scheduled: "Sep 28 12:51 PM" });
    const result = parseScheduledDate(item);
    expect(result).toBeInstanceOf(Date);
    expect(result!.getFullYear()).toBe(new Date().getFullYear());
    expect(result!.getMonth()).toBe(8); // September
    expect(result!.getDate()).toBe(28);
  });

  it("still honours an explicit year in the label", () => {
    const item = makeItem({ scheduled: "Sep 15, 2026 - 7:30 PM" });
    expect(parseScheduledDate(item)!.getFullYear()).toBe(2026);
  });

  it("prefers scheduledISO over the label", () => {
    const item = makeItem({ scheduledISO: "2026-09-15T10:30:00Z", scheduled: "Dec 1 9:00 AM" });
    expect(parseScheduledDate(item)!.getFullYear()).toBe(2026);
  });

  it("returns null for a day that does not exist instead of rolling over", () => {
    expect(parseScheduledDate(makeItem({ scheduled: "Feb 31, 2026 9:00 AM" }))).toBeNull();
  });

  it("honours 12-hour clock edge cases", () => {
    const midnight = parseScheduledDate(makeItem({ scheduled: "Sep 15, 2026 12:00 AM" }))!;
    expect(midnight.getHours()).toBe(0);
    const noon = parseScheduledDate(makeItem({ scheduled: "Sep 15, 2026 12:00 PM" }))!;
    expect(noon.getHours()).toBe(12);
    const evening = parseScheduledDate(makeItem({ scheduled: "Sep 15, 2026 7:30 PM" }))!;
    expect(evening.getHours()).toBe(19);
  });

  it("accepts a hyphen separator without an em dash", () => {
    expect(parseScheduledDate(makeItem({ scheduled: "Sep 15, 2026 - 7:30 PM" }))).toBeInstanceOf(Date);
  });

  it("accepts a comma before the time, as toLocaleString emits", () => {
    // Regression: the label produced by formatScheduledLabel / toLocaleString
    // is "Sep 28, 2026, 7:30 PM" and the time was silently dropped to midnight.
    const d = parseScheduledDate(makeItem({ scheduled: "Sep 28, 2026, 7:30 PM" }))!;
    expect(d.getFullYear()).toBe(2026);
    expect(d.getHours()).toBe(19);
    expect(d.getMinutes()).toBe(30);
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
    const d = new Date(2026, 8, 2); // Sep 2, 2026 â€” Wednesday
    const start = getWeekStart(d);
    expect(start.getDay()).toBe(1); // Monday
    expect(start.getDate()).toBe(31); // Aug 31
  });

  it("returns same day if Monday", () => {
    const d = new Date(2026, 8, 7); // Sep 7, 2026 â€” Monday
    const start = getWeekStart(d);
    expect(start.getDay()).toBe(1);
    expect(start.getDate()).toBe(7);
  });

  it("returns previous Monday if Sunday", () => {
    const d = new Date(2026, 8, 6); // Sep 6, 2026 â€” Sunday
    const start = getWeekStart(d);
    expect(start.getDay()).toBe(1);
    expect(start.getDate()).toBe(31); // Aug 31
  });
});

describe("getDueScheduledPosts", () => {
  const now = new Date("2026-09-23T12:00:00");

  function item(id: number, status: ContentItem["status"], iso: string): ContentItem {
    return makeItem({ id, status, scheduledISO: iso });
  }

  it("returns only scheduled posts due at or before now", () => {
    const content = [
      item(1, "scheduled", "2026-09-23T11:00:00"),
      item(2, "scheduled", "2026-09-23T13:00:00"),
      item(3, "published", "2026-09-23T10:00:00"),
      item(4, "draft", "2026-09-23T10:00:00"),
    ];
    const due = getDueScheduledPosts(content, now, () => true);
    expect(due.map(d => d.item.id)).toEqual([1]);
  });

  it("includes posts exactly at now", () => {
    const content = [item(1, "scheduled", "2026-09-23T12:00:00")];
    const due = getDueScheduledPosts(content, now, () => true);
    expect(due.map(d => d.item.id)).toEqual([1]);
  });

  it("sorts oldest first", () => {
    const content = [
      item(1, "scheduled", "2026-09-23T11:00:00"),
      item(2, "scheduled", "2026-09-23T08:00:00"),
      item(3, "scheduled", "2026-09-23T10:00:00"),
    ];
    const due = getDueScheduledPosts(content, now, () => true);
    expect(due.map(d => d.item.id)).toEqual([2, 3, 1]);
  });

  it("reports channelConnected from the callback", () => {
    const content = [
      item(1, "scheduled", "2026-09-23T11:00:00"),
      item(2, "scheduled", "2026-09-23T10:00:00"),
    ];
    const due = getDueScheduledPosts(content, now, c => c.id === 1);
    expect(due.find(d => d.item.id === 1)!.channelConnected).toBe(true);
    expect(due.find(d => d.item.id === 2)!.channelConnected).toBe(false);
  });

  it("skips posts with no parseable date", () => {
    const content = [makeItem({ id: 1, status: "scheduled", scheduled: "not a date" })];
    const due = getDueScheduledPosts(content, now, () => true);
    expect(due).toEqual([]);
  });

  it("returns empty when no posts", () => {
    expect(getDueScheduledPosts([], now, () => true)).toEqual([]);
  });
});

describe("schedule picker helpers", () => {
  it("round-trips a local wall-clock value through the picker", () => {
    const d = new Date(2026, 8, 28, 19, 30); // 28 Sep 2026, 19:30 local
    const value = toDatetimeLocalValue(d);
    expect(value).toBe("2026-09-28T19:30");
    // Feeding the picker value back must yield the same instant.
    expect(new Date(value).getTime()).toBe(d.getTime());
  });

  it("pads single-digit month, day, hour and minute", () => {
    expect(toDatetimeLocalValue(new Date(2026, 0, 5, 7, 5))).toBe("2026-01-05T07:05");
  });

  it("returns an empty value for missing or invalid dates", () => {
    expect(toDatetimeLocalValue(null)).toBe("");
    expect(toDatetimeLocalValue(new Date("nope"))).toBe("");
  });

  it("formats a label that parseScheduledDate can read back", () => {
    const d = new Date(2026, 8, 28, 19, 30);
    const label = formatScheduledLabel(d);
    expect(label).toContain("2026");
    const round = parseScheduledDate({ id: 1, brand: "B", brandColor: "#fff", campaign: "", pillar: "",
      platform: "Facebook", status: "scheduled", caption: "", hashtags: "", scheduled: label,
      format: "Post", score: 0 });
    expect(round).toBeInstanceOf(Date);
    expect(round!.getFullYear()).toBe(2026);
    expect(round!.getMonth()).toBe(8);
    expect(round!.getDate()).toBe(28);
    expect(round!.getHours()).toBe(19);
    expect(round!.getMinutes()).toBe(30);
  });
});