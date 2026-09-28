import type { ContentItem } from "@/types";

export function parseScheduledDate(item: ContentItem): Date | null {
  if (item.scheduledISO) {
    const d = new Date(item.scheduledISO);
    return isNaN(d.getTime()) ? null : d;
  }
  if (!item.scheduled) return null;
  const s = item.scheduled.replace(/—/, "").replace(/\s+/g, " ").trim();
  const d = new Date(s);
  return isNaN(d.getTime()) ? null : d;
}

export function dateKey(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export function addDays(d: Date, n: number): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);
}

export function getWeekStart(d: Date): Date {
  const day = d.getDay();
  return addDays(d, day === 0 ? -6 : 1 - day);
}

export interface DuePost {
  item: ContentItem;
  date: Date;
  channelConnected: boolean;
}

// Posts that are scheduled, due at-or-before `now`, and sorted oldest-first.
// `isChannelConnected` lets the caller plug in branding lookup; posts with no
// connected channel are still returned (channelConnected=false) so the queue can
// show them as needing manual publishing.
export function getDueScheduledPosts(
  content: ContentItem[],
  now: Date,
  isChannelConnected: (item: ContentItem) => boolean,
): DuePost[] {
  return content
    .filter(c => c.status === "scheduled")
    .flatMap(item => {
      const date = parseScheduledDate(item);
      if (date === null || date.getTime() > now.getTime()) return [];
      return [{ item, date, channelConnected: isChannelConnected(item) }];
    })
    .sort((a, b) => a.date.getTime() - b.date.getTime());
}
