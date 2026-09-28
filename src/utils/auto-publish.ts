import type { BrandChannel, ContentItem, PlatformDef } from "@/types";
import { getDueScheduledPosts } from "./calendar-helpers";

export interface AutoPublishHandlers {
  findChannel: (item: ContentItem) => BrandChannel | null;
  findDef: (channel: BrandChannel) => PlatformDef | null;
  publish: (item: ContentItem, channel: BrandChannel, defn: PlatformDef) => Promise<{ success: boolean; message: string }>;
  onPublished: (item: ContentItem, defn: PlatformDef) => void | Promise<void>;
  onFailed: (item: ContentItem, defn: PlatformDef, message: string) => void | Promise<void>;
  isCancelled?: () => boolean;
}

export interface AutoPublishReport {
  published: number[];
  skipped: number[];
  failed: { id: number; message: string }[];
}

/**
 * One auto-publish tick. Finds every scheduled post due at-or-before `now`,
 * publishes the ones whose brand has a connected channel (oldest first) and
 * calls back for status flips / toasts. Posts already in `inFlight` are
 * skipped so overlapping ticks can't double-publish.
 */
export async function runAutoPublish(
  content: ContentItem[],
  now: Date,
  inFlight: Set<number>,
  h: AutoPublishHandlers,
): Promise<AutoPublishReport> {
  const report: AutoPublishReport = { published: [], skipped: [], failed: [] };
  const due = getDueScheduledPosts(content, now, item => {
    const ch = h.findChannel(item);
    return !!ch?.connected;
  });

  for (const entry of due) {
    if (h.isCancelled?.()) break;
    const item = entry.item;
    if (inFlight.has(item.id)) continue;
    if (!entry.channelConnected) { report.skipped.push(item.id); continue; }
    const channel = h.findChannel(item);
    if (!channel) { report.skipped.push(item.id); continue; }
    const defn = h.findDef(channel);
    if (!defn) { report.skipped.push(item.id); continue; }

    inFlight.add(item.id);
    try {
      const result = await h.publish(item, channel, defn);
      if (h.isCancelled?.()) continue;
      if (result.success) {
        await h.onPublished(item, defn);
        report.published.push(item.id);
      } else {
        await h.onFailed(item, defn, result.message);
        report.failed.push({ id: item.id, message: result.message });
      }
    } finally {
      inFlight.delete(item.id);
    }
  }

  return report;
}