import { getDueScheduledPosts, parseScheduledDate } from "./calendar-helpers";
import type { ContentItem } from "@/types";

export type PublishState =
  | "queued"
  | "publishing"
  | "success"
  | "failed"
  | "blocked"
  | "skipped";

export interface PublishAttempt {
  /** 1-based attempt number. */
  attempt: number;
  at: string;
  success: boolean;
  message: string;
  /** True when the failure is a config/connection problem, so a retry cannot help. */
  blocked: boolean;
}

export interface PublishEntry {
  itemId: number;
  platform: string;
  brand: string;
  state: PublishState;
  attempts: PublishAttempt[];
  lastMessage: string;
  /** False when the target channel is missing or not connected. */
  connected: boolean;
}

export interface PublishOutcome {
  state: PublishState;
  attempts: PublishAttempt[];
  lastMessage: string;
  connected: boolean;
}

export interface PublishRunReport {
  published: number[];
  failed: number[];
  blocked: number[];
  skipped: number[];
}

export type PublishFilter = "due" | "all" | "failed";

export const MAX_PUBLISH_ATTEMPTS = 3;

/** Pairs that will never succeed on a retry — surface them as "needs setup" instead. */
const NON_RETRYABLE =
  /not connected|no connected channel|credentials|api key|access token|missing|configure|unauthori[sz]ed|forbidden|invalid|401|403|not supported|unsupported platform/i;

/** A burst of failures against distinct channels is an outage, not bad content. */
const CIRCUIT_THRESHOLD = 4;

export function isNonRetryableMessage(message: string): boolean {
  return NON_RETRYABLE.test(message);
}

export function canRetry(entry: Pick<PublishEntry, "state" | "connected" | "attempts">): boolean {
  if (entry.state !== "failed" || !entry.connected) return false;
  const last = entry.attempts[entry.attempts.length - 1];
  if (last?.blocked) return false;
  return entry.attempts.length < MAX_PUBLISH_ATTEMPTS;
}

export function publishStateLabel(state: PublishState): string {
  switch (state) {
    case "queued": return "Queued";
    case "publishing": return "Publishing";
    case "success": return "Published";
    case "failed": return "Failed";
    case "blocked": return "Needs setup";
    case "skipped": return "Skipped";
  }
}

export function summarizeReport(report: PublishRunReport): string {
  const { published, failed, blocked, skipped } = report;
  const ok = published.length;
  const bad = failed.length + blocked.length;
  if (ok === 0 && bad === 0) return skipped.length > 0 ? `Cancelled — ${skipped.length} left in the queue` : "Nothing to publish";
  const parts: string[] = [];
  if (ok > 0) parts.push(`${ok} published`);
  if (bad > 0) parts.push(`${bad} failed`);
  if (skipped.length > 0) parts.push(`${skipped.length} skipped`);
  return parts.join(" · ");
}

// ── Queue building ───────────────────────────────────────────────────────────

export type QueueBuildOptions = "reset" | "preserve";

/**
 * Merge a fresh view of the scheduled content into the existing queue.
 *
 * Successful / failed / blocked / skipped attempts are never rebuilt from
 * scratch — otherwise every render or a later auto-publish failure would wipe
 * the run history. Only `queued` rows are re-evaluated against the content list:
 * a post that is no longer due is dropped, a post that came back (e.g. it was
 * rescheduled into the past) is re-added, and a post that already has a
 * terminal result is left untouched.
 */
export function buildQueue(
  existing: PublishEntry[],
  content: ContentItem[],
  now: Date,
  isConnected: (item: ContentItem) => boolean,
  options: QueueBuildOptions = "preserve",
): PublishEntry[] {
  const due = getDueScheduledPosts(content, now, isConnected);
  const known = new Map(existing.map(e => [e.itemId, e]));
  const next: PublishEntry[] = [];

  for (const { item, channelConnected } of due) {
    const prev = known.get(item.id);
    const keep = prev && (options === "preserve" || prev.state === "success" || prev.state === "publishing");
    next.push(keep ? prev : makeQueueEntry(item, channelConnected));
  }

  // Rows the user published by hand (or an auto-publish tick) while the queue
  // was open: keep the success, drop anything still queued for that post.
  for (const entry of existing) {
    if (next.some(e => e.itemId === entry.itemId)) continue;
    if (entry.state !== "success") continue;
    const item = content.find(c => c.id === entry.itemId);
    const date = item ? parseScheduledDate(item) : null;
    if (!item || item.status === "published" || (date !== null && date.getTime() > now.getTime())) next.push(entry);
  }

  return next.sort((a, b) => a.itemId - b.itemId);
}

function formatDue(item: ContentItem): string {
  const d = parseScheduledDate(item);
  if (!d) return "";
  return d.toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  });
}

/** A fresh, never-attempted queue row. Exported so the UI can enqueue a post
 *  that isn't due yet (manual "Publish Now" on an upcoming item). */
export function makeQueueEntry(item: ContentItem, connected: boolean): PublishEntry {
  return {
    itemId: item.id,
    platform: item.platform,
    brand: item.brand,
    state: "queued",
    attempts: [],
    lastMessage: connected
      ? `Due ${formatDue(item)} — ready to publish`
      : `${item.platform} not connected for ${item.brand} — configure in Brands → Publishing Channels.`,
    connected,
  };
}

// ── Running ──────────────────────────────────────────────────────────────────

export interface PublishHandlers {
  /** Missing or not-connected channel. Returning false skips the publish call. */
  canPublish: (item: ContentItem) => boolean;
  publish: (item: ContentItem) => Promise<{ success: boolean; message: string }>;
  onPublished?: (item: ContentItem, message: string) => void | Promise<void>;
  isCancelled?: () => boolean;
}

export interface PublishRunOptions {
  /** Rows still to publish, oldest first; a full run resolves the queue. */
  entries: PublishEntry[];
  content: ContentItem[];
  /** Cancel the run and mark the remaining rows as skipped. */
  onCancelToken?: { cancelled: boolean };
}

export type PublishRunPatch =
  | { type: "start"; itemId: number }
  | { type: "attempt"; itemId: number; outcome: PublishOutcome; result: { success: boolean; message: string } }
  | { type: "skip"; itemId: number }
  | { type: "circuit"; itemId: number; message: string }
  | { type: "progress"; index: number; total: number }
  | { type: "clear" }
  | { type: "report"; report: PublishRunReport };

export function emptyReport(): PublishRunReport {
  return { published: [], failed: [], blocked: [], skipped: [] };
}

/**
 * Publish every row in `entries`, oldest first, one at a time.
 *
 * The caller decides which rows are publishable (`buildQueue` owns the due/connected
 * rules); this only resolves them, so a post is never re-queued by a second pass.
 * Progress is reported through `onPatch`; the caller owns the state, so results
 * survive a panel close and re-render.
 */
export async function runPublishQueue(
  opts: PublishRunOptions,
  h: PublishHandlers,
  onPatch: (patch: PublishRunPatch) => void,
): Promise<PublishRunReport> {
  const report = emptyReport();
  const targets = opts.entries.filter(e => e.state === "queued" || e.state === "failed");
  const total = targets.length;
  let index = 0;
  let tripped = 0;

  for (const entry of targets) {
    if (opts.onCancelToken?.cancelled) { report.skipped.push(entry.itemId); onPatch({ type: "skip", itemId: entry.itemId }); continue; }

    const item = opts.content.find(c => c.id === entry.itemId);
    if (!item) { report.skipped.push(entry.itemId); onPatch({ type: "skip", itemId: entry.itemId }); continue; }

    const connected = h.canPublish(item);
    if (!connected) {
      onPatch({ type: "attempt", itemId: item.id, outcome: blockedOutcome(entry, item), result: { success: false, message: "not connected" } });
      report.blocked.push(item.id);
      index++;
      onPatch({ type: "progress", index, total });
      continue;
    }

    if (tripped >= CIRCUIT_THRESHOLD) {
      onPatch({ type: "circuit", itemId: item.id, message: `Skipped — ${tripped} consecutive publish failures. Check your connections and retry.` });
      report.skipped.push(item.id);
      continue;
    }

    onPatch({ type: "start", itemId: item.id });
    index++;
    // A publish already in flight is always resolved and recorded, even if the
    // run was cancelled meanwhile — dropping it would leave the post published
    // upstream while the UI still shows it as scheduled, and the next tick would
    // publish it a second time.
    const result = await publishOne(item, h);
    const outcome = recordAttempt(entry, result.success, result.message, h.isCancelled?.() ?? false);
    onPatch({ type: "attempt", itemId: item.id, outcome, result });

    if (result.success) {
      await h.onPublished?.(item, result.message);
      report.published.push(item.id);
      tripped = 0;
    } else {
      report[outcome.state === "blocked" ? "blocked" : "failed"].push(item.id);
      tripped++;
    }
    onPatch({ type: "progress", index, total });
  }

  onPatch({ type: "report", report });
  return report;
}

function blockedOutcome(entry: PublishEntry, item: ContentItem): PublishOutcome {
  const message = `${item.platform} not connected for ${item.brand} — configure in Brands → Publishing Channels.`;
  return {
    state: "blocked",
    attempts: recordAttempt(entry, false, message, false).attempts,
    lastMessage: message,
    connected: false,
  };
}

async function publishOne(item: ContentItem, h: PublishHandlers): Promise<{ success: boolean; message: string }> {
  try {
    const result = await h.publish(item);
    if (!result || typeof result.success !== "boolean") {
      return { success: false, message: "Publisher returned no result" };
    }
    return { success: result.success, message: result.message };
  } catch (error) {
    return { success: false, message: error instanceof Error ? error.message : String(error) };
  }
}

function recordAttempt(
  entry: PublishEntry,
  success: boolean,
  message: string,
  cancelled: boolean,
): PublishOutcome {
  const blocked = !success && !cancelled && isNonRetryableMessage(message);
  const attempts: PublishAttempt[] = [
    ...entry.attempts,
    { attempt: entry.attempts.length + 1, at: new Date().toISOString(), success, message, blocked },
  ];
  return {
    state: success ? "success" : blocked ? "blocked" : "failed",
    attempts,
    lastMessage: success
      ? message
      : blocked
        ? message
        : attempts.length >= MAX_PUBLISH_ATTEMPTS
          ? `${message} — gave up after ${MAX_PUBLISH_ATTEMPTS} attempts`
          : message,
    connected: true,
  };
}

// ── Helpers shared with the UI ───────────────────────────────────────────────

export function retryableIds(entries: PublishEntry[]): number[] {
  return entries.filter(canRetry).map(e => e.itemId);
}
export function resetEntries(entries: PublishEntry[], ids: number[]): PublishEntry[] {
  const reset = new Set(ids);
  return entries.map(e =>
    reset.has(e.itemId)
      ? { ...e, state: "queued" as PublishState, attempts: [], lastMessage: "" }
      : e,
  );
}

export function countByState(entries: PublishEntry[], state: PublishState): number {
  return entries.filter(e => e.state === state).length;
}
