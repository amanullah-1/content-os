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
