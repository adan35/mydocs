import { create } from 'zustand';
import type { EntryId } from '@/domain/types';
import { ws, useApp } from './app-store';
import { api, ApiError } from './cloud';
import { editorActions } from './editor-store';
import { prefs } from './prefs';
import { navigate } from './router';
import { openEntry } from './actions';

export type ShareRole = 'owner' | 'edit' | 'view';
export type LinkRole = 'off' | 'view' | 'edit';

/** A local document that is live-shared. Stored on this device, per workspace. */
export interface Binding {
  id: string;
  /** Link secret, when the document was opened from a link. */
  key?: string;
  role: ShareRole;
}

export interface ShareInfo {
  name: string;
  owner: { name: string; email: string };
  role: ShareRole;
  linkRole: LinkRole;
  /** Owner only. */
  linkKey?: string;
  members?: Record<string, 'view' | 'edit'>;
}

export interface Invite {
  id: string;
  name: string;
  ownerName: string;
  role: string;
  at: number;
}

const storeKey = (wsId: string) => `mydoc:shares:${wsId}`;

export const useShares = create<{ bindings: Record<EntryId, Binding> }>(() => ({ bindings: {} }));

function load() {
  const s = useApp.getState().session;
  useShares.setState({
    bindings: s ? prefs.get<Record<EntryId, Binding>>(storeKey(s.workspace.id), {}) : {},
  });
}
load();
let loadedFor = useApp.getState().session?.workspace.id;
useApp.subscribe((s) => {
  if (s.session?.workspace.id === loadedFor) return;
  loadedFor = s.session?.workspace.id;
  load();
});

export function setBinding(entryId: EntryId, binding: Binding | null) {
  const s = useApp.getState().session;
  if (!s) return;
  const bindings = { ...useShares.getState().bindings };
  if (binding) bindings[entryId] = binding;
  else delete bindings[entryId];
  prefs.set(storeKey(s.workspace.id), bindings);
  useShares.setState({ bindings });
}

/** The link anyone can open, in My Doc, on any device. */
export const shareUrl = (id: string, key: string) =>
  `${location.origin}${location.pathname}#/s/${encodeURIComponent(id)}?k=${encodeURIComponent(key)}`;

export const fetchInfo = (b: Binding) =>
  api<ShareInfo>(`/api/shares/${encodeURIComponent(b.id)}`, { key: b.key });

/** Starts sharing a document with the text it has right now. */
export async function startSharing(entryId: EntryId): Promise<Binding> {
  const entry = ws().get(entryId);
  if (!entry) throw new ApiError('This document no longer exists.', 404);
  const text = editorActions.textOf(entryId) ?? (await ws().readText(entryId));
  const { id } = await api<{ id: string; linkKey: string }>('/api/shares', {
    body: { name: entry.name, text },
  });
  const binding: Binding = { id, role: 'owner' };
  setBinding(entryId, binding);
  return binding;
}

export const updateSharing = (
  id: string,
  patch: {
    linkRole?: LinkRole;
    rotateKey?: boolean;
    addMember?: { email: string; role: 'view' | 'edit' };
    removeMember?: string;
  },
) => api<ShareInfo>(`/api/shares/${encodeURIComponent(id)}/settings`, { body: patch });

/** Ends sharing for everyone. The document stays on this device as a normal one. */
export async function stopSharing(entryId: EntryId) {
  const b = useShares.getState().bindings[entryId];
  if (!b) return;
  await api(`/api/shares/${encodeURIComponent(b.id)}`, { method: 'DELETE' });
  setBinding(entryId, null);
}

/** Stops syncing this copy; it stays here as a normal document. */
export const leaveShare = (entryId: EntryId) => setBinding(entryId, null);

export const listInvites = () => api<Invite[]>('/api/shares');

/**
 * Opens a shared document: the copy already here, or a new one in "Shared with me".
 * The text arrives once the live connection syncs.
 */
export async function openShared(id: string, key?: string) {
  const copies = Object.entries(useShares.getState().bindings).filter(([, b]) => b.id === id);
  const existing = copies.find(([entryId]) => ws().get(entryId));
  // Copies the user deleted must not keep a connection or block opening a fresh one.
  for (const [entryId] of copies)
    if (entryId !== existing?.[0] && !ws().get(entryId)) setBinding(entryId, null);
  if (existing) {
    await openEntry(existing[0]);
    return existing[0];
  }
  const info = await fetchInfo({ id, key, role: 'view' });
  const folder = await ws().ensureFolder(null, 'Shared with me');
  const entry = await ws().createFile(folder.id, info.name, '');
  setBinding(entry.id, { id, key, role: info.role });
  await openEntry(entry.id);
  navigate({ name: 'doc', id: entry.id }, { replace: true });
  return entry.id;
}

export interface SharedHistory {
  authors: { name: string; email?: string }[];
  sessions: {
    a: number;
    start: number;
    end: number;
    edits: number;
    lines: { type: 'add' | 'del'; text: string }[];
    truncated: boolean;
  }[];
  older: number;
  blame: { a: number; t: number; text: string }[];
  blameTruncated: boolean;
}

/** Who changed what in a shared document, from the server's record of every edit. */
export const fetchHistory = (b: Binding) =>
  api<SharedHistory>(`/api/shares/${encodeURIComponent(b.id)}/history`, { key: b.key });
