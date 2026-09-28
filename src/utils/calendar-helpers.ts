import type { ContentItem } from "@/types";
import { isFullyApproved } from "./approval";

const MONTHS: Record<string, number> = { jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5, jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11 };

// Accepts "Sep 15, 2026 - 7:30 PM", "Sep 15, 2026 7:30 PM", "Sep 28 12:51 PM",
// "Sep 15 2026" and the comma-separated "Sep 28, 2026, 7:30 PM" that
// toLocaleString produces. The year is optional and defaults to the current
// year: without it the engine assumes 2001, which makes a post look decades
// overdue. The time separator may be a space, a comma, or both.
const SCHED_RE = /^([A-Za-z]{3,9})\.?\s+(\d{1,2})(?:\s*,?\s*(\d{4}))?(?:\s*,?\s*(\d{1,2}):(\d{2})\s*([AaPp][Mm])?)?/;

export function parseScheduledDate(item: ContentItem): Date | null {
  if (item.scheduledISO) {
    const d = new Date(item.scheduledISO);
    return isNaN(d.getTime()) ? null : d;
  }
  if (!item.scheduled) return null;
  // Normalise em/en dashes used as separators; a bare hyphen is part of the
  // time range, so treat it as whitespace too.
  const s = item.scheduled.replace(/[\u2014\u2013-]/g, " ").replace(/\s+/g, " ").trim();
  const m = SCHED_RE.exec(s);
  if (!m) return null;
  const month = MONTHS[m[1].slice(0, 3).toLowerCase()];
  if (month === undefined) return null;
  const day = Number(m[2]);
  const year = m[3] ? Number(m[3]) : new Date().getFullYear();
  let hours = 0;
  let minutes = 0;
  if (m[4] !== undefined) {
    hours = Number(m[4]);
    minutes = Number(m[5]);
    const meridiem = m[6]?.toLowerCase();
    if (meridiem === "pm" && hours < 12) hours += 12;
    else if (meridiem === "am" && hours === 12) hours = 0;
  }
  const d = new Date(year, month, day, hours, minutes, 0, 0);
  // Reject rollovers such as "Feb 31" instead of silently sliding into March.
  if (isNaN(d.getTime()) || d.getFullYear() !== year || d.getMonth() !== month || d.getDate() !== day) return null;
  return d;
}

export function dateKey(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/** Format a Date the way schedule labels are stored and displayed. */
export function formatScheduledLabel(d: Date): string {
  return d.toLocaleString("en-US", {
    month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit",
  });
}

/** Value for an <input type="datetime-local">, which expects local wall-clock time. */
export function toDatetimeLocalValue(d: Date | null): string {
  if (!d || isNaN(d.getTime())) return "";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
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

// Is this post eligible to be published automatically?
//
// The Approval tab and the publish scheduler were two independent writers to
// `status`, and only one of them was honoured here. Approving a post set
// status to "approved"/"review", which this filter excluded, so clicking
// Approve silently made a scheduled post *unpublishable* - the timer could
// never reach it again. Nothing promoted it back to "scheduled".
//
// So eligibility is: explicitly scheduled, OR fully approved through the
// 4-stage flow with a time attached. An approved post with no scheduled date is
// still not due - it needs a time before there is anything to publish against.
export function isAutoPublishable(item: ContentItem): boolean {
  if (item.status === "scheduled") return true;
  return item.status === "approved" && isFullyApproved(item.approvalStage ?? 0);
}

// Posts that are publishable, due at-or-before `now`, and sorted oldest-first.
// `isChannelConnected` lets the caller plug in branding lookup; posts with no
// connected channel are still returned (channelConnected=false) so the queue can
// show them as needing manual publishing.
export function getDueScheduledPosts(
  content: ContentItem[],
  now: Date,
  isChannelConnected: (item: ContentItem) => boolean,
): DuePost[] {
  return content
    .filter(isAutoPublishable)
    .flatMap(item => {
      const date = parseScheduledDate(item);
      if (date === null || date.getTime() > now.getTime()) return [];
      return [{ item, date, channelConnected: isChannelConnected(item) }];
    })
    .sort((a, b) => a.date.getTime() - b.date.getTime());
}
