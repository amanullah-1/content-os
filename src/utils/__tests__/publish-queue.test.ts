import { describe, it, expect, vi } from "vitest";
import {
  buildQueue, canRetry, countByState, isNonRetryableMessage, makeQueueEntry,
  resetEntries, retryableIds, runPublishQueue, summarizeReport,
  MAX_PUBLISH_ATTEMPTS, emptyReport,
  type PublishEntry, type PublishRunPatch,
} from "../publish-queue";
import type { ContentItem } from "@/types";

const NOW = new Date("2026-09-24T12:00:00");

function item(overrides: Partial<ContentItem> = {}): ContentItem {
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
    scheduled: "Sep 24, 2026 — 9:00 AM",
    scheduledISO: "2026-09-24T09:00:00",
    format: "Article",
    score: 80,
    ...overrides,
  };
}

const due = (id: number, over: Partial<ContentItem> = {}) => item({ id, scheduledISO: "2026-09-24T09:00:00", ...over });
const later = (id: number, over: Partial<ContentItem> = {}) => item({ id, scheduledISO: "2026-09-30T09:00:00", ...over });
const alwaysConnected = () => true;

function entry(over: Partial<PublishEntry> = {}): PublishEntry {
  return {
    itemId: 1,
    platform: "Dev.to",
    brand: "FakeCo",
    state: "queued",
    attempts: [],
    lastMessage: "",
    connected: true,
    ...over,
  };
}

const failAttempt = (message: string, blocked = false) => ({
  attempt: 1, at: NOW.toISOString(), success: false, message, blocked,
});

describe("buildQueue", () => {
  it("queues due scheduled posts and leaves the rest out", () => {
    const content = [due(1), later(2), due(3, { status: "draft" })];
    const queue = buildQueue([], content, NOW, alwaysConnected);
    expect(queue.map(e => e.itemId)).toEqual([1]);
    expect(queue[0]).toMatchObject({ state: "queued", connected: true, platform: "Dev.to", brand: "FakeCo" });
  });

  it("keeps oldest-due-first ordering", () => {
    const content = [
      due(1, { scheduledISO: "2026-09-24T11:00:00" }),
      due(2, { scheduledISO: "2026-09-23T08:00:00" }),
      due(3, { scheduledISO: "2026-09-24T09:30:00" }),
    ];
    expect(buildQueue([], content, NOW, alwaysConnected).map(e => e.itemId)).toEqual([1, 2, 3]);
  });

  it("marks rows with no connected channel", () => {
    const queue = buildQueue([], [due(1)], NOW, () => false);
    expect(queue[0].connected).toBe(false);
    expect(queue[0].lastMessage).toMatch(/not connected/i);
  });

  it("preserves failures and successes across a rebuild", () => {
    const content = [due(1), due(2)];
    const first = buildQueue([], content, NOW, alwaysConnected);
    const played = [
      { ...first[0], state: "success" as const, attempts: [{ attempt: 1, at: "", success: true, message: "ok", blocked: false }] },
      { ...first[1], state: "failed" as const, attempts: [failAttempt("HTTP 500")] },
    ];
    const second = buildQueue(played, content, NOW, alwaysConnected);
    expect(second.map(e => e.state)).toEqual(["success", "failed"]);
    expect(second[1].attempts).toHaveLength(1);
  });

  it("re-queues a failed post once the channel is connected", () => {
    const content = [due(1)];
    const blocked = [entry({ itemId: 1, state: "blocked", connected: false, attempts: [failAttempt("not connected", true)] })];
    expect(buildQueue(blocked, content, NOW, alwaysConnected)[0].state).toBe("blocked");
    expect(buildQueue(blocked, content, NOW, alwaysConnected, "reset")[0].state).toBe("queued");
  });

  it("drops queued rows for posts that are no longer due", () => {
    const first = buildQueue([], [due(1)], NOW, alwaysConnected);
    expect(first).toHaveLength(1);
    expect(buildQueue(first, [due(1, { scheduledISO: "2026-10-01T09:00:00" })], NOW, alwaysConnected)).toHaveLength(0);
  });

  it("keeps successes for posts published outside the panel", () => {
    const first = buildQueue([], [due(1), due(2)], NOW, alwaysConnected);
    const played = [
      { ...first[0], state: "success" as const, attempts: [{ attempt: 1, at: "", success: true, message: "ok", blocked: false }] },
      first[1],
    ];
    const content = [{ ...due(1), status: "published" as const }, { ...due(2), status: "published" as const }];
    const next = buildQueue(played, content, NOW, alwaysConnected);
    expect(next.map(e => [e.itemId, e.state])).toEqual([[1, "success"]]);
  });

  it("re-adds a post that came back into the due window", () => {
    const moved = [due(1, { scheduledISO: "2026-10-05T09:00:00" })];
    expect(buildQueue([entry({ itemId: 1 })], moved, NOW, alwaysConnected)).toHaveLength(0);
    expect(buildQueue([], [due(1)], NOW, alwaysConnected)).toHaveLength(1);
  });
});

describe("attempt helpers", () => {
  it("flags config errors as non-retryable", () => {
    expect(isNonRetryableMessage("Invalid access token")).toBe(true);
    expect(isNonRetryableMessage("Proxy error: HTTP 403")).toBe(true);
    expect(isNonRetryableMessage("X not connected for FakeCo")).toBe(true);
    expect(isNonRetryableMessage("HTTP 502 Bad Gateway")).toBe(false);
  });

  it("allows retry of a plain failure", () => {
    expect(canRetry(entry({ state: "failed", attempts: [failAttempt("HTTP 500")] }))).toBe(true);
  });

  it("refuses retry when blocked, disconnected or out of attempts", () => {
    expect(canRetry(entry({ state: "failed", attempts: [failAttempt("bad token", true)] }))).toBe(false);
    expect(canRetry(entry({ state: "failed", connected: false, attempts: [failAttempt("HTTP 500")] }))).toBe(false);
    const spent = Array.from({ length: MAX_PUBLISH_ATTEMPTS }, () => failAttempt("HTTP 500"));
    expect(canRetry(entry({ state: "failed", attempts: spent }))).toBe(false);
  });

  it("lists and resets retryable rows only", () => {
    const rows = [
      entry({ itemId: 1, state: "failed", attempts: [failAttempt("HTTP 500")] }),
      entry({ itemId: 2, state: "blocked", connected: false, attempts: [failAttempt("bad token", true)] }),
      entry({ itemId: 3, state: "success", attempts: [{ attempt: 1, at: "", success: true, message: "ok", blocked: false }] }),
    ];
    expect(retryableIds(rows)).toEqual([1]);
    expect(resetEntries(rows, [1])[0]).toMatchObject({ state: "queued", attempts: [], itemId: 1 });
    expect(resetEntries(rows, [1])[1].state).toBe("blocked");
    expect(countByState(rows, "blocked")).toBe(1);
  });

  it("builds a fresh row", () => {
    expect(makeQueueEntry(due(4), false)).toMatchObject({ itemId: 4, state: "queued", connected: false });
  });
});

describe("runPublishQueue", () => {
  function setup(rows: PublishEntry[], content: ContentItem[], publish = vi.fn().mockResolvedValue({ success: true, message: "Published" })) {
    const patches: PublishRunPatch[] = [];
    const onPublished = vi.fn();
    const run = runPublishQueue(
      { entries: rows, content },
      { canPublish: () => true, publish, onPublished },
      p => patches.push(p),
    );
    return { run, patches, publish, onPublished };
  }

  it("publishes every queued post once, oldest first", async () => {
    const content = [due(1), due(2)];
    const { run, publish, onPublished } = setup(buildQueue([], content, NOW, alwaysConnected), content);
    const report = await run;
    expect(publish.mock.calls.map(c => (c[0] as ContentItem).id)).toEqual([1, 2]);
    expect(onPublished.mock.calls.map(c => (c[0] as ContentItem).id)).toEqual([1, 2]);
    expect(report.published).toEqual([1, 2]);
    expect(report.failed).toEqual([]);
  });

  it("keeps going after a partial failure and reports both sides", async () => {
    const content = [due(1), due(2), due(3)];
    const publish = vi.fn()
      .mockResolvedValueOnce({ success: true, message: "Published to Dev.to — Article #1" })
      .mockResolvedValueOnce({ success: false, message: "HTTP 500" })
      .mockResolvedValueOnce({ success: true, message: "Published to Dev.to — Article #3" });
    const { run, patches, onPublished } = setup(buildQueue([], content, NOW, alwaysConnected), content, publish);
    const report = await run;
    expect(report.published).toEqual([1, 3]);
    expect(report.failed).toEqual([2]);
    expect(onPublished).toHaveBeenCalledTimes(2);
    const attempts = patches.filter((p): p is Extract<PublishRunPatch, { type: "attempt" }> => p.type === "attempt");
    expect(attempts.map(p => [p.itemId, p.outcome.state])).toEqual([[1, "success"], [2, "failed"], [3, "success"]]);
  });

  it("marks a missing channel as blocked without calling the publisher", async () => {
    const content = [due(1)];
    const queue = buildQueue([], content, NOW, () => false);
    const publish = vi.fn();
    const patches: PublishRunPatch[] = [];
    const report = await runPublishQueue(
      { entries: queue, content },
      { canPublish: () => false, publish },
      p => patches.push(p),
    );
    expect(publish).not.toHaveBeenCalled();
    expect(report.blocked).toEqual([1]);
    const attempt = patches.find(p => p.type === "attempt") as Extract<PublishRunPatch, { type: "attempt" }>;
    expect(attempt.outcome.state).toBe("blocked");
    expect(attempt.outcome.attempts[0].blocked).toBe(true);
  });

  it("classifies auth errors as blocked and rate limits as retryable", async () => {
    const content = [due(1), due(2)];
    const publish = vi.fn()
      .mockResolvedValueOnce({ success: false, message: "HTTP 401 Unauthorized" })
      .mockResolvedValueOnce({ success: false, message: "HTTP 429 Too Many Requests" });
    const { run } = setup(buildQueue([], content, NOW, alwaysConnected), content, publish);
    const report = await run;
    expect(report.blocked).toEqual([1]);
    expect(report.failed).toEqual([2]);
  });

  it("turns a thrown publisher error into a failure and keeps publishing", async () => {
    const content = [due(1), due(2)];
    const publish = vi.fn()
      .mockRejectedValueOnce(new Error("network down"))
      .mockResolvedValueOnce({ success: true, message: "Published" });
    const { run, patches } = setup(buildQueue([], content, NOW, alwaysConnected), content, publish);
    const report = await run;
    expect(report.failed).toEqual([1]);
    expect(report.published).toEqual([2]);
    const attempt = patches.find(p => p.type === "attempt" && p.itemId === 1) as Extract<PublishRunPatch, { type: "attempt" }>;
    expect(attempt.outcome.lastMessage).toMatch(/network down/);
  });

  it("gives up after the attempt cap", async () => {
    const content = [due(1)];
    const spent = Array.from({ length: MAX_PUBLISH_ATTEMPTS - 1 }, () => failAttempt("HTTP 500"));
    const queue = [entry({ itemId: 1, state: "failed", attempts: spent })];
    const { run, patches } = setup(queue, content, vi.fn().mockResolvedValue({ success: false, message: "HTTP 500" }));
    await run;
    const attempt = patches.find(p => p.type === "attempt") as Extract<PublishRunPatch, { type: "attempt" }>;
    expect(attempt.outcome.state).toBe("failed");
    expect(attempt.outcome.attempts).toHaveLength(MAX_PUBLISH_ATTEMPTS);
    expect(attempt.outcome.lastMessage).toBe(`HTTP 500 — gave up after ${MAX_PUBLISH_ATTEMPTS} attempts`);
    expect(canRetry(attempt.outcome)).toBe(false);
  });

  it("appends to the attempt history on a retry", async () => {
    const content = [due(1)];
    const failed = [entry({ itemId: 1, state: "failed", attempts: [failAttempt("HTTP 500")] })];
    const { run, patches } = setup(resetEntries(failed, [1]).map(e => ({ ...e, attempts: failed[0].attempts })), content,
      vi.fn().mockResolvedValue({ success: true, message: "Published on attempt 2" }));
    const report = await run;
    expect(report.published).toEqual([1]);
    const attempt = patches.find(p => p.type === "attempt") as Extract<PublishRunPatch, { type: "attempt" }>;
    expect(attempt.outcome.attempts).toHaveLength(2);
    expect(attempt.outcome.attempts[1].success).toBe(true);
  });

  it("never republishes a row that already succeeded", async () => {
    const content = [due(1), due(2)];
    const done = entry({ itemId: 1, state: "success", attempts: [{ attempt: 1, at: "", success: true, message: "ok", blocked: false }] });
    const { run, publish } = setup([done, entry({ itemId: 2 })], content);
    const report = await run;
    expect(publish).toHaveBeenCalledTimes(1);
    expect(report.published).toEqual([2]);
  });

  it("skips posts that vanished from the content list", async () => {
    const publish = vi.fn();
    const report = await runPublishQueue(
      { entries: [entry({ itemId: 9 })], content: [] },
      { canPublish: () => true, publish },
      () => {},
    );
    expect(publish).not.toHaveBeenCalled();
    expect(report.skipped).toEqual([9]);
  });

  it("stops on cancel and marks the rest skipped", async () => {
    const content = [due(1), due(2)];
    const token = { cancelled: false };
    const publish = vi.fn().mockImplementation(async () => { token.cancelled = true; return { success: true, message: "Published" }; });
    const report = await runPublishQueue(
      { entries: buildQueue([], content, NOW, alwaysConnected), content, onCancelToken: token },
      { canPublish: () => true, publish },
      () => {},
    );
    expect(publish).toHaveBeenCalledTimes(1);
    expect(report.published).toEqual([1]);
    expect(report.skipped).toEqual([2]);
  });

  it("trips a circuit breaker after a burst of distinct-channel failures", async () => {
    const content = [1, 2, 3, 4, 5, 6].map(id => due(id, { platform: id % 2 ? "Dev.to" : "Facebook" }));
    const patches: PublishRunPatch[] = [];
    const publish = vi.fn().mockResolvedValue({ success: false, message: "HTTP 500" });
    const report = await runPublishQueue(
      { entries: buildQueue([], content, NOW, alwaysConnected), content },
      { canPublish: () => true, publish },
      p => patches.push(p),
    );
    expect(publish).toHaveBeenCalledTimes(4);
    expect(report.failed).toEqual([1, 2, 3, 4]);
    expect(report.skipped).toEqual([5, 6]);
    const circuit = patches.find(p => p.type === "circuit") as Extract<PublishRunPatch, { type: "circuit" }>;
    expect(circuit.itemId).toBe(5);
    expect(circuit.message).toMatch(/4 consecutive publish failures/);
  });

  it("reports progress for every resolved row", async () => {
    const content = [due(1), due(2)];
    const { run, patches } = setup(buildQueue([], content, NOW, alwaysConnected), content);
    await run;
    const progress = patches.filter(p => p.type === "progress") as Extract<PublishRunPatch, { type: "progress" }>[];
    expect(progress).toEqual([{ type: "progress", index: 1, total: 2 }, { type: "progress", index: 2, total: 2 }]);
    expect(patches.filter(p => p.type === "start").map(p => (p as { itemId: number }).itemId)).toEqual([1, 2]);
  });
});

describe("summarizeReport", () => {
  it("describes a mixed run", () => {
    const r = emptyReport();
    r.published.push(1);
    r.failed.push(2, 3);
    expect(summarizeReport(r)).toBe("1 published · 2 failed");
  });

  it("describes an empty and a cancelled run", () => {
    expect(summarizeReport(emptyReport())).toBe("Nothing to publish");
    const r = emptyReport();
    r.skipped.push(1, 2);
    expect(summarizeReport(r)).toBe("Cancelled — 2 left in the queue");
  });
});
