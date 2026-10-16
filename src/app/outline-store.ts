import { create } from 'zustand';
import type { EntryId } from '@/domain/types';
import type { OutlineItem } from '@/domain/outline';

/**
 * Outlines published by document views that work out their own structure: a PDF's
 * bookmarks or pages, a workbook's sheets, a Word file's headings, the tables of a
 * document in the sheet view. The side panel shows the one for the open document.
 */
export interface DocOutline {
  items: OutlineItem[];
  /** Index of the item in view, or -1. */
  active: number;
  /** What the items are, for the summary line ("headings", "pages", "sheets"). */
  noun: string;
  /** Extra summary after the count ("12 pages"). */
  summary?: string;
  /** Shown when there are no items. */
  empty?: string;
  jump(index: number): void;
}

export const useOutlines = create<Record<EntryId, DocOutline>>(() => ({}));

export function publishOutline(id: EntryId, outline: DocOutline | null) {
  useOutlines.setState((s) => {
    const next = { ...s };
    if (outline) next[id] = outline;
    else delete next[id];
    return next;
  }, true);
}
