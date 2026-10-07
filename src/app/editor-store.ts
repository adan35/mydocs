import { create } from 'zustand';
import type { EntryId } from '@/domain/types';
import { fileTypeOf, isTextType } from '@/domain/names';
import { useApp, ws } from './app-store';
import { useSettings } from './settings-store';
import { prefs } from './prefs';
import { toastError, toast } from './toast-store';
import { ownership } from './ownership';

export type SaveStatus = 'loading' | 'saved' | 'unsaved' | 'saving' | 'error';

export interface Buffer {
  id: EntryId;
  text: string;
  /** Text as last persisted. `text !== savedText` means there are unsaved edits. */
  savedText: string;
  status: SaveStatus;
  error?: string;
  /** Bumps when text is replaced from outside the editor (restore, link rewrite, tag edit). */
  rev: number;
}

/** Asks the document view to move keyboard focus into a document, optionally at a match. */
export interface FocusRequest {
  id: EntryId;
  /** Search terms: the first match is selected and scrolled into view. */
  find?: string[];
  /** Put the cursor at the end (new documents). */
  end?: boolean;
  at: number;
}

interface EditorState {
  tabs: EntryId[];
  /** Pinned tabs stay first and survive "close others", "close all" and "close to the right". */
  pinned: EntryId[];
  activeId: EntryId | null;
  closed: EntryId[];
  buffers: Record<EntryId, Buffer>;
  focusRequest: FocusRequest | null;
}

export const useEditor = create<EditorState>(() => ({
  tabs: [],
  pinned: [],
  activeId: null,
  closed: [],
  buffers: {},
  focusRequest: null,
}));

const get = useEditor.getState;
const set = useEditor.setState;
const timers = new Map<EntryId, ReturnType<typeof setTimeout>>();
const retries = new Map<EntryId, number>();
const inflight = new Map<EntryId, Promise<void>>();
const tabsKey = (wsId: string) => `mydoc:tabs:${wsId}`;
const recoveryKey = (wsId: string) => `mydoc:recovery:${wsId}`;

function patchBuffer(id: EntryId, patch: Partial<Buffer>) {
  set((s) => {
    const b = s.buffers[id];
    return b ? { buffers: { ...s.buffers, [id]: { ...b, ...patch } } } : s;
  });
}

function persistTabs() {
  const s = useApp.getState().session;
  if (!s) return;
  const { tabs, activeId, pinned } = get();
  prefs.set(tabsKey(s.workspace.id), { tabs, activeId, pinned });
}

async function loadBuffer(id: EntryId) {
  if (get().buffers[id]) return;
  set((s) => ({
    buffers: { ...s.buffers, [id]: { id, text: '', savedText: '', status: 'loading', rev: 0 } },
  }));
  try {
    const text = await ws().readText(id);
    set((s) => ({
      buffers: { ...s.buffers, [id]: { id, text, savedText: text, status: 'saved', rev: 1 } },
    }));
  } catch (err) {
    patchBuffer(id, { status: 'error', error: 'This document could not be read.' });
    toastError('Unable to open this document.', err);
  }
}

function scheduleSave(id: EntryId, delay = useSettings.getState().autosaveDelay) {
  clearTimeout(timers.get(id));
  timers.set(
    id,
    setTimeout(() => void editorActions.flush(id), delay),
  );
}

/** Writes all dirty buffers to localStorage synchronously, for crash/close recovery. */
export function writeRecoveryDrafts() {
  const s = useApp.getState().session;
  // A tab that handed the data to another tab must not overwrite that tab's drafts.
  if (!s || !ownership.isOwner) return;
  const drafts: Record<EntryId, { text: string; at: number }> = {};
  for (const b of Object.values(get().buffers)) {
    if (b.status !== 'loading' && b.text !== b.savedText)
      drafts[b.id] = { text: b.text, at: Date.now() };
  }
  if (!Object.keys(drafts).length) {
    prefs.remove(recoveryKey(s.workspace.id));
  } else if (!prefs.set(recoveryKey(s.workspace.id), drafts) && !warnedDraftFailure) {
    warnedDraftFailure = true;
    toast({
      message: 'Unsaved changes could not be stored as a recovery copy.',
      detail:
        'Browser storage may be full. Keep this tab open until "Saved" appears, or export the document.',
      tone: 'error',
    });
  }
}

let warnedDraftFailure = false;

export const editorActions = {
  async open(id: EntryId, opts: { activate?: boolean } = {}) {
    const entry = ws().get(id);
    if (!entry || entry.kind !== 'file') return;
    set((s) => ({
      tabs: s.tabs.includes(id) ? s.tabs : [...s.tabs, id],
      activeId: opts.activate === false ? s.activeId : id,
    }));
    persistTabs();
    if (ws().isTextEntry(entry) && isTextType(fileTypeOf(entry.name))) await loadBuffer(id);
  },

  requestFocus(id: EntryId, opts: { find?: string[]; end?: boolean } = {}) {
    set({ focusRequest: { id, ...opts, at: Date.now() } });
  },

  /** Returns the pending focus request for a document (if still fresh) and clears it. */
  takeFocusRequest(id: EntryId): FocusRequest | null {
    const req = get().focusRequest;
    if (!req || req.id !== id) return null;
    set({ focusRequest: null });
    return Date.now() - req.at < 5000 ? req : null;
  },

  activate(id: EntryId | null) {
    set({ activeId: id });
    persistTabs();
  },

  setText(id: EntryId, text: string) {
    const b = get().buffers[id];
    if (!b || b.text === text) return;
    patchBuffer(id, { text, status: text === b.savedText ? 'saved' : 'unsaved' });
    scheduleSave(id);
  },

  /** Saves a buffer now (if dirty). Resolves once persisted or failed. */
  async flush(id: EntryId): Promise<void> {
    clearTimeout(timers.get(id));
    timers.delete(id);
    const pending = inflight.get(id);
    if (pending) await pending;
    const b = get().buffers[id];
    if (!b || b.status === 'loading' || b.text === b.savedText) return;
    const text = b.text;
    const run = (async () => {
      patchBuffer(id, { status: 'saving', error: undefined });
      try {
        await ws().saveText(id, text);
        retries.delete(id);
        const cur = get().buffers[id];
        if (!cur) return;
        patchBuffer(id, { savedText: text, status: cur.text === text ? 'saved' : 'unsaved' });
        if (cur.text !== text) scheduleSave(id);
        writeRecoveryDrafts();
      } catch (err) {
        const attempt = (retries.get(id) ?? 0) + 1;
        retries.set(id, attempt);
        writeRecoveryDrafts();
        patchBuffer(id, {
          status: 'error',
          error: err instanceof Error ? err.message : 'Unable to save.',
        });
        if (attempt === 1) {
          toastError(
            'Unable to save this document. Your changes are still here and kept locally.',
            err,
            {
              label: 'Try again',
              run: () => void editorActions.flush(id),
            },
          );
        }
        // Keep retrying with backoff; edits are never dropped.
        scheduleSave(id, Math.min(30_000, 2000 * 2 ** (attempt - 1)));
      }
    })();
    inflight.set(id, run);
    try {
      await run;
    } finally {
      inflight.delete(id);
    }
  },

  async flushAll() {
    await Promise.all(Object.keys(get().buffers).map((id) => editorActions.flush(id)));
  },

  /** Drops every tab and buffer without saving (after handing the data to another tab). */
  reset() {
    for (const t of timers.values()) clearTimeout(t);
    timers.clear();
    retries.clear();
    set({ tabs: [], pinned: [], activeId: null, buffers: {}, closed: [], focusRequest: null });
  },

  hasUnsaved(): boolean {
    return Object.values(get().buffers).some(
      (b) => b.status !== 'loading' && b.text !== b.savedText,
    );
  },

  async close(id: EntryId) {
    await editorActions.flush(id);
    const b = get().buffers[id];
    if (b && b.text !== b.savedText) {
      toast({
        message: 'This tab has changes that could not be saved yet, so it stays open.',
        tone: 'error',
      });
      return;
    }
    set((s) => {
      const i = s.tabs.indexOf(id);
      const tabs = s.tabs.filter((t) => t !== id);
      const buffers = { ...s.buffers };
      delete buffers[id];
      const activeId =
        s.activeId === id ? (tabs[Math.min(i, tabs.length - 1)] ?? null) : s.activeId;
      return {
        tabs,
        buffers,
        activeId,
        pinned: s.pinned.filter((p) => p !== id),
        closed: [id, ...s.closed.filter((c) => c !== id)].slice(0, 20),
      };
    });
    persistTabs();
  },

  async closeOthers(id: EntryId) {
    const { tabs, pinned } = get();
    for (const t of tabs) if (t !== id && !pinned.includes(t)) await editorActions.close(t);
  },

  /** Closes every unpinned tab. */
  async closeAll() {
    const { tabs, pinned } = get();
    for (const t of tabs) if (!pinned.includes(t)) await editorActions.close(t);
  },

  async closeToRight(id: EntryId) {
    const { tabs, pinned } = get();
    for (const t of tabs.slice(tabs.indexOf(id) + 1))
      if (!pinned.includes(t)) await editorActions.close(t);
  },

  togglePin(id: EntryId) {
    set((s) => {
      if (!s.tabs.includes(id)) return s;
      const pinned = s.pinned.includes(id)
        ? s.pinned.filter((p) => p !== id)
        : [...s.pinned.filter((p) => s.tabs.includes(p)), id];
      // Pinned tabs come first, in pin order; the rest keep their order.
      const tabs = [...pinned, ...s.tabs.filter((t) => !pinned.includes(t))];
      return { pinned, tabs };
    });
    persistTabs();
  },

  /** Returns the id of the reopened tab, if any. */
  async reopenClosed(): Promise<EntryId | null> {
    const tree = ws().tree;
    const closed = get().closed;
    const id = closed.find((c) => tree.get(c) && !tree.isTrashed(c));
    if (!id) return null;
    set({ closed: closed.filter((c) => c !== id) });
    await editorActions.open(id);
    return id;
  },

  reorder(from: number, to: number) {
    set((s) => {
      const tabs = [...s.tabs];
      const [moved] = tabs.splice(from, 1);
      if (moved === undefined) return s;
      // Pinned and unpinned tabs each stay in their own group.
      const pinnedCount = s.pinned.filter((p) => p !== moved && s.tabs.includes(p)).length;
      const target = s.pinned.includes(moved)
        ? Math.min(to, pinnedCount)
        : Math.max(to, pinnedCount);
      tabs.splice(target, 0, moved);
      return { tabs };
    });
    persistTabs();
  },

  /** Restores tabs from the last session and applies any recovery drafts. */
  async restoreSession() {
    const s = useApp.getState().session;
    if (!s) return;
    for (const id of Object.keys(get().buffers)) clearTimeout(timers.get(id));
    set({ tabs: [], pinned: [], activeId: null, buffers: {}, closed: [] });
    const tree = s.workspace.tree;
    const drafts = prefs.get<Record<EntryId, { text: string; at: number }>>(
      recoveryKey(s.workspace.id),
      {},
    );
    let recovered = 0;
    for (const [id, draft] of Object.entries(drafts)) {
      if (!tree.get(id) || typeof draft?.text !== 'string') continue;
      const stored = await s.workspace.readText(id);
      if (stored === draft.text) continue;
      try {
        await s.workspace.saveText(id, draft.text, 'recovery');
        recovered++;
      } catch (err) {
        toastError('Some unsaved changes could not be recovered yet.', err);
        return;
      }
    }
    prefs.remove(recoveryKey(s.workspace.id));
    if (recovered) {
      toast({
        message: `Recovered unsaved changes in ${recovered} document${recovered > 1 ? 's' : ''}.`,
        detail: 'The previous text is kept in version history.',
        tone: 'success',
      });
    }
    const saved = prefs.get<{ tabs: EntryId[]; activeId: EntryId | null; pinned?: EntryId[] }>(
      tabsKey(s.workspace.id),
      {
        tabs: [],
        activeId: null,
      },
    );
    const live = saved.tabs.filter((id) => tree.get(id)?.kind === 'file' && !tree.isTrashed(id));
    const pinned = (saved.pinned ?? []).filter((id) => live.includes(id));
    set({
      tabs: [...pinned, ...live.filter((id) => !pinned.includes(id))],
      pinned,
      activeId: live.includes(saved.activeId ?? '') ? saved.activeId : (live[0] ?? null),
    });
    for (const id of live) {
      const e = tree.get(id)!;
      if (s.workspace.isTextEntry(e) && isTextType(fileTypeOf(e.name))) void loadBuffer(id);
    }
  },

  /** Keeps buffers in sync with workspace changes made outside the editor. */
  onExternalContent(ids: EntryId[]) {
    for (const id of ids) {
      const b = get().buffers[id];
      if (!b) continue;
      const text = ws().allTexts().get(id);
      if (text === undefined || text === b.savedText) continue;
      if (b.text === b.savedText) {
        patchBuffer(id, { text, savedText: text, status: 'saved', rev: b.rev + 1 });
      } else {
        // Local edits win; they'll be saved over the external change (which is versioned).
        patchBuffer(id, { savedText: text });
      }
    }
  },

  /** Closes tabs whose entries were trashed or deleted. */
  onTreeChange() {
    const tree = ws().tree;
    const gone = get().tabs.filter((id) => !tree.get(id) || tree.isTrashed(id));
    if (!gone.length) return;
    set((s) => {
      const tabs = s.tabs.filter((t) => !gone.includes(t));
      const buffers = { ...s.buffers };
      for (const id of gone) {
        clearTimeout(timers.get(id));
        delete buffers[id];
      }
      return {
        tabs,
        buffers,
        pinned: s.pinned.filter((p) => !gone.includes(p)),
        activeId:
          s.activeId && gone.includes(s.activeId) ? (tabs[tabs.length - 1] ?? null) : s.activeId,
      };
    });
    persistTabs();
  },
};
