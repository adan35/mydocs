import type { EntryId } from '@/domain/types';

/** Ids from `a` to `b` inclusive, in visible row order (either direction). */
export function rangeBetween(order: EntryId[], a: EntryId, b: EntryId): EntryId[] {
  const i = order.indexOf(a);
  const j = order.indexOf(b);
  if (i < 0 || j < 0) return [b];
  return order.slice(Math.min(i, j), Math.max(i, j) + 1);
}

/** Drops items inside another selected folder, so nothing is moved or trashed twice. */
export function topLevel(ids: EntryId[], isWithin: (id: EntryId, ancestor: EntryId) => boolean) {
  return ids.filter((id) => !ids.some((other) => other !== id && isWithin(id, other)));
}
