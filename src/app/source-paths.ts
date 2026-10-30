import type { EntryId } from '@/domain/types';
import { prefs } from './prefs';

/**
 * Where a document was opened from on the computer, for "Show in File Explorer". Only the
 * desktop app learns this (the system hands it the path); browsers never expose one.
 */
const KEY = 'mydoc-source-paths';

export const sourcePaths = {
  get: (id: EntryId): string | undefined => prefs.get<Record<EntryId, string>>(KEY, {})[id],
  set(id: EntryId, path: string) {
    prefs.set(KEY, { ...prefs.get<Record<EntryId, string>>(KEY, {}), [id]: path });
  },
};
