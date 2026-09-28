import type { ContentItem } from "@/types";

/**
 * Apply per-id patches to a content array, returning a new array.
 *
 * Every mutation must derive from the *current* state, never from a
 * render-time snapshot captured in a closure. Bulk actions (approve-all,
 * reject-all, set-status-on-many) fire N updates synchronously in one tick, so
 * they all shared a single stale snapshot: each persisted an array with only its
 * own item changed, and the last write silently discarded the rest. In-memory
 * state looked right because the state update itself was functional, so the
 * loss only surfaced on reload.
 */
export function patchItems(
  items: ContentItem[],
  patchById: ReadonlyMap<number, Partial<ContentItem>>,
): ContentItem[] {
  if (patchById.size === 0) return items;
  return items.map(item => {
    const patch = patchById.get(item.id);
    return patch ? { ...item, ...patch } : item;
  });
}

/** Read-modify-write a single item, returning a new array. */
export function patchItem(
  items: ContentItem[],
  id: number,
  patch: Partial<ContentItem>,
): ContentItem[] {
  return patchItems(items, new Map([[id, patch]]));
}
