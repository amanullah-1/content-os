import { describe, it, expect } from "vitest";
import { patchItem, patchItems } from "../content-ops";
import type { ContentItem } from "@/types";

function item(id: number, overrides: Partial<ContentItem> = {}): ContentItem {
  return {
    id,
    brand: "Test",
    brandColor: "#000",
    campaign: "",
    pillar: "",
    platform: "Facebook",
    status: "review",
    caption: `post ${id}`,
    hashtags: "",
    scheduled: "",
    format: "",
    score: 0,
    ...overrides,
  };
}

describe("patchItems", () => {
  it("applies a patch to the matching item only", () => {
    const before = [item(1), item(2), item(3)];
    const after = patchItem(before, 2, { status: "approved" });
    expect(after.map(i => i.status)).toEqual(["review", "approved", "review"]);
  });

  it("does not mutate the input array", () => {
    const before = [item(1)];
    patchItem(before, 1, { status: "approved" });
    expect(before[0].status).toBe("review");
  });

  it("returns the same array reference when there is nothing to patch", () => {
    const before = [item(1)];
    expect(patchItems(before, new Map())).toBe(before);
  });

  // Regression: bulk approve fired N synchronous updates in one tick, each
  // persisting an array derived from one stale render-time snapshot. Only the
  // last item's approval survived a reload. Deriving each write from the
  // previous result is what makes the whole batch stick.
  it("accumulates successive single-item patches applied back to back", () => {
    let current = [item(1), item(2), item(3), item(4), item(5)];
    for (const id of [1, 2, 3, 4, 5]) {
      current = patchItem(current, id, { status: "approved", approvalStage: 4 });
    }
    expect(current.every(i => i.status === "approved")).toBe(true);
    expect(current.every(i => i.approvalStage === 4)).toBe(true);
  });

  it("applies a multi-id patch in one pass without dropping siblings", () => {
    const before = [item(1), item(2), item(3), item(4)];
    const after = patchItems(before, new Map([
      [1, { status: "approved" }],
      [3, { status: "approved" }],
    ]));
    expect(after.map(i => i.status)).toEqual(["approved", "review", "approved", "review"]);
  });

  it("leaves other fields intact when patching a subset", () => {
    const before = [item(1, { scheduledISO: "2026-09-28T10:00:00.000Z", caption: "keep me" })];
    const after = patchItem(before, 1, { status: "approved" });
    expect(after[0].caption).toBe("keep me");
    expect(after[0].scheduledISO).toBe("2026-09-28T10:00:00.000Z");
  });

  it("ignores ids that are not present", () => {
    const before = [item(1)];
    const after = patchItems(before, new Map([[99, { status: "approved" }]]));
    expect(after).toEqual(before);
  });

  it("supports rejecting a batch back to draft without touching the rest", () => {
    const before = [item(1, { status: "review" }), item(2, { status: "approved" })];
    const after = patchItems(before, new Map([[1, { status: "draft" }]]));
    expect(after.map(i => i.status)).toEqual(["draft", "approved"]);
  });
});
