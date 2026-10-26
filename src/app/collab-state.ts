import { create } from 'zustand';
import type { EntryId } from '@/domain/types';
import { cloudAvailable } from './cloud';
import { useShares, type ShareRole } from './share';

export type LiveStatus =
  /** Reading the document's access and connecting. Not editable yet. */
  | 'connecting'
  | 'live'
  /** The connection dropped. The document is read-only until it returns, so copies never fork. */
  | 'offline'
  | 'signin'
  | 'denied';

export interface LiveState {
  status: LiveStatus;
  role?: ShareRole;
  /** Other people in the document right now. */
  people: string[];
  message?: string;
}

export const useCollab = create<{ live: Record<EntryId, LiveState> }>(() => ({ live: {} }));

/** True while a shared document can't be edited: viewing only, or not connected right now. */
export function useReadOnly(id: EntryId): boolean {
  const bound = useShares((s) => !!s.bindings[id]);
  const live = useCollab((s) => s.live[id]);
  return cloudAvailable && bound && !(live?.status === 'live' && live.role !== 'view');
}
