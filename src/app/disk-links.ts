import { openDB, type IDBPDatabase } from 'idb';
import { create } from 'zustand';
import type { EntryId } from '@/domain/types';
import { useApp } from './app-store';
import { editorActions, useEditor } from './editor-store';
import { textFromBytes } from './importer';
import { useRouter } from './router';

/**
 * Links between workspace documents and the files on the user's computer they were
 * imported from. Where the browser supports the File System Access API (Chrome, Edge, and
 * the Windows desktop app), the link works both ways:
 *
 * - every save of a linked text document is written back to the original file;
 * - when the file changes on disk (edited in another app, replaced, synced), My Doc reads
 *   it again and the open document updates in place. Open documents are checked every
 *   couple of seconds, every linked file when the window regains focus.
 *
 * If the document also has edits in My Doc that never reached the file, nothing is
 * overwritten either way: the link shows "Changed on disk" and the person picks a side.
 * Binary files (Word, Excel, PDF, images) are refreshed from disk but never written.
 *
 * Elsewhere there are no links: imported files are edited in the workspace and exported
 * by download.
 *
 * Handles are kept in their own IndexedDB database, keyed by workspace and entry, so the
 * link survives reloads. The browser may ask again for permission after a restart; until
 * then the document shows an "Allow saving to disk" button (permission needs a click).
 */

export type DiskLinkState =
  | 'synced'
  | 'writing'
  | 'needs-permission'
  | 'error'
  /** The file changed on disk while the document had edits that aren't on disk. */
  | 'conflict';

export interface DiskLink {
  /** File name on disk (it can differ from the document name after a rename). */
  fileName: string;
  state: DiskLinkState;
  error?: string;
  /** Read-only link: refreshed from disk, never written. */
  binary?: boolean;
  /** When the file was last read from disk because it changed there. */
  refreshedAt?: number;
}

export const useDiskLinks = create<{ links: Record<EntryId, DiskLink> }>(() => ({ links: {} }));

interface PermissionHandle extends FileSystemFileHandle {
  queryPermission?(d: { mode: 'read' | 'readwrite' }): Promise<PermissionState>;
  requestPermission?(d: { mode: 'read' | 'readwrite' }): Promise<PermissionState>;
}

/** What the file on disk held when My Doc last read or wrote it. */
interface Stamp {
  lastModified: number;
  size: number;
  /** Hash of the text (text links). */
  hash?: number;
  /** The workspace entry's `updatedAt` right after the last sync (binary links). */
  syncedAt?: number;
}

/** Stored per link. Older versions stored the bare handle. */
interface Record_ {
  handle: PermissionHandle;
  binary?: boolean;
  stamp?: Stamp;
}

const DB = 'mydoc-disk-links';
/** Permission prompts shown right after an import; later files ask on their own button. */
const MAX_PROMPTS = 3;
const STORE = 'links';
/** How often open documents are checked for changes on disk. */
export const POLL_MS = 2000;
/** A full check of every link runs at most this often (on window focus). */
const SWEEP_MS = 10_000;
const handles = new Map<EntryId, PermissionHandle>();
const binaries = new Set<EntryId>();
const stamps = new Map<EntryId, Stamp>();
/** Disk contents waiting for the person to choose a side, per document. */
const conflicts = new Map<EntryId, { text?: string; blob?: Blob; stamp: Stamp }>();
/** Latest text waiting to be written, per document; writes are serialized per file. */
const pendingText = new Map<EntryId, string>();
const writing = new Map<EntryId, Promise<void>>();
const checking = new Set<EntryId>();
let workspaceId: string | null = null;
let dbPromise: Promise<IDBPDatabase> | null = null;

function db() {
  dbPromise ??= openDB(DB, 1, {
    upgrade(d) {
      d.createObjectStore(STORE);
    },
  });
  return dbPromise;
}

const key = (id: EntryId) => `${workspaceId}:${id}`;

/** FNV-1a over the UTF-16 code units, plus the length: cheap change detection. */
export function textHash(text: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h ^ text.length) >>> 0;
}

function setLink(id: EntryId, link: DiskLink | null) {
  useDiskLinks.setState((s) => {
    const links = { ...s.links };
    if (link) links[id] = link;
    else delete links[id];
    return { links };
  });
}

function patch(id: EntryId, p: Partial<DiskLink>) {
  const cur = useDiskLinks.getState().links[id];
  if (cur) setLink(id, { ...cur, ...p });
}

const stateOf = (id: EntryId) => useDiskLinks.getState().links[id]?.state;

function workspace() {
  return useApp.getState().session?.workspace ?? null;
}

/** Whether this browser can link imported files to disk. */
export function canSaveToDisk(): boolean {
  return typeof window !== 'undefined' && 'showOpenFilePicker' in window;
}

async function permission(
  h: PermissionHandle,
  ask: boolean,
  mode: 'read' | 'readwrite' = 'readwrite',
): Promise<PermissionState> {
  try {
    if (ask && h.requestPermission) return await h.requestPermission({ mode });
    if (h.queryPermission) return await h.queryPermission({ mode });
    return 'granted';
  } catch {
    // requestPermission throws without a user gesture.
    return 'prompt';
  }
}

function describe(err: unknown): string {
  const name = err instanceof DOMException ? err.name : '';
  if (name === 'NotFoundError') return 'The original file was moved or deleted.';
  if (name === 'NotAllowedError') return 'Permission to edit the file was denied.';
  if (name === 'NoModificationAllowedError') return 'The file is read-only or locked.';
  return err instanceof Error ? err.message : 'Unable to write the file.';
}

async function persist(id: EntryId) {
  const h = handles.get(id);
  if (!h || !workspaceId) return;
  const rec: Record_ = { handle: h, binary: binaries.has(id), stamp: stamps.get(id) };
  try {
    await (await db()).put(STORE, rec, key(id));
  } catch {
    /* the link still works until reload */
  }
}

function setStamp(id: EntryId, file: File, extra: Pick<Stamp, 'hash' | 'syncedAt'>) {
  stamps.set(id, { lastModified: file.lastModified, size: file.size, ...extra });
  void persist(id);
}

async function writeNow(id: EntryId, ask: boolean): Promise<void> {
  const h = handles.get(id);
  if (!h) return;
  for (;;) {
    const text = pendingText.get(id);
    if (text === undefined) return;
    // Never write over a change made on disk that the person hasn't seen yet.
    if (stateOf(id) === 'conflict') return;
    // The file already holds this text (it was just read from disk, or nothing changed).
    if (stamps.get(id)?.hash === textHash(text)) {
      pendingText.delete(id);
      continue;
    }
    if ((await permission(h, ask)) !== 'granted') {
      patch(id, { state: 'needs-permission', error: undefined });
      return;
    }
    // Someone changed the file since My Doc last saw it: ask instead of overwriting.
    if (await changedOnDisk(id, h, text)) return;
    pendingText.delete(id);
    patch(id, { state: 'writing' });
    try {
      const out = await h.createWritable();
      await out.write(text);
      await out.close();
      try {
        setStamp(id, await h.getFile(), { hash: textHash(text) });
      } catch {
        stamps.set(id, { lastModified: 0, size: -1, hash: textHash(text) });
      }
      patch(id, { state: 'synced', error: undefined });
    } catch (err) {
      // Keep the text so Retry writes the latest version.
      if (!pendingText.has(id)) pendingText.set(id, text);
      patch(id, { state: 'error', error: describe(err) });
      return;
    }
  }
}

/**
 * Whether the file holds text My Doc hasn't seen (and isn't about to write). If so the
 * link goes into conflict, keeping the disk text for the person to choose.
 */
async function changedOnDisk(id: EntryId, h: PermissionHandle, text: string): Promise<boolean> {
  const known = stamps.get(id);
  if (known?.hash === undefined) return false;
  try {
    const file = await h.getFile();
    if (file.lastModified === known.lastModified && file.size === known.size) return false;
    const disk = textFromBytes(new Uint8Array(await file.arrayBuffer()), file.name);
    if (disk === null) return false;
    const hash = textHash(disk);
    if (hash === known.hash || hash === textHash(text)) return false;
    conflicts.set(id, { text: disk, stamp: { ...stampOf(file), hash } });
    patch(id, { state: 'conflict' });
    return true;
  } catch {
    // Missing or unreadable: the write reports it.
    return false;
  }
}

function schedule(id: EntryId, ask: boolean): Promise<void> {
  const prev = writing.get(id) ?? Promise.resolve();
  const next = prev.then(() => writeNow(id, ask));
  writing.set(id, next);
  void next.finally(() => writing.get(id) === next && writing.delete(id));
  return next;
}

/** The text My Doc currently holds for a document: the open editor's, or the stored one. */
function localText(id: EntryId): string | undefined {
  const b = useEditor.getState().buffers[id];
  if (b && b.status !== 'loading') return b.text;
  return workspace()?.allTexts().get(id);
}

/** Puts text read from disk into the document; an open editor follows (undoably). */
async function applyText(id: EntryId, text: string) {
  const ws = workspace();
  if (!ws?.get(id)) return;
  const b = useEditor.getState().buffers[id];
  if (b && b.status !== 'loading' && b.text !== b.savedText) {
    // Local edits are being dropped on purpose (conflict resolved for the disk side).
    editorActions.replaceText(id, text);
    await editorActions.flush(id);
  } else {
    await ws.replaceContent(id, text);
  }
}

async function applyBlob(id: EntryId, blob: Blob): Promise<number | undefined> {
  const ws = workspace();
  if (!ws?.get(id)) return undefined;
  return (await ws.replaceContent(id, blob)).updatedAt;
}

/**
 * Compares a linked file with what My Doc last saw of it and takes in any change made on
 * disk. Returns whether the document changed.
 */
async function check(id: EntryId): Promise<boolean> {
  const h = handles.get(id);
  const ws = workspace();
  const entry = ws?.get(id);
  if (!h || !ws || !entry || checking.has(id) || writing.has(id) || pendingText.has(id))
    return false;
  const state = stateOf(id);
  if (state === 'needs-permission' || state === 'writing') return false;
  checking.add(id);
  try {
    if ((await permission(h, false, 'read')) !== 'granted') {
      patch(id, { state: 'needs-permission' });
      return false;
    }
    let file: File;
    try {
      file = await h.getFile();
    } catch (err) {
      patch(id, { state: 'error', error: describe(err) });
      return false;
    }
    const known = stamps.get(id);
    if (known && known.lastModified === file.lastModified && known.size === file.size) {
      if (state === 'error' && !pendingText.has(id))
        patch(id, { state: 'synced', error: undefined });
      return false;
    }
    const binary = binaries.has(id);
    if (binary) {
      const blob = new Blob([await file.arrayBuffer()], { type: file.type || entry.mime || '' });
      const current = await ws.readBlob(id);
      if (current && (await sameBytes(current, blob))) {
        setStamp(id, file, { syncedAt: entry.updatedAt });
        return false;
      }
      // Changed in My Doc since the last sync too (a spreadsheet edited here)?
      const editedHere = known?.syncedAt !== undefined && entry.updatedAt > known.syncedAt;
      if (editedHere) {
        conflicts.set(id, { blob, stamp: stampOf(file) });
        patch(id, { state: 'conflict' });
        return false;
      }
      const updatedAt = await applyBlob(id, blob);
      setStamp(id, file, { syncedAt: updatedAt ?? entry.updatedAt });
      patch(id, { state: 'synced', error: undefined, refreshedAt: Date.now() });
      return true;
    }
    const text = textFromBytes(new Uint8Array(await file.arrayBuffer()), file.name || entry.name);
    if (text === null) return false;
    const hash = textHash(text);
    if (known?.hash === hash) {
      setStamp(id, file, { hash });
      return false;
    }
    const local = localText(id);
    if (local === undefined) return false;
    if (textHash(local) === hash) {
      setStamp(id, file, { hash });
      if (state === 'conflict') resolvedQuietly(id);
      return false;
    }
    // Links from older versions have no record of the last sync: the newer side wins.
    const localSynced =
      known?.hash !== undefined
        ? textHash(local) === known.hash
        : file.lastModified >= entry.updatedAt;
    const b = useEditor.getState().buffers[id];
    const dirty = !!b && b.status !== 'loading' && b.text !== b.savedText;
    if (!localSynced || dirty) {
      if (!known?.hash && !dirty) {
        // An old link where My Doc is newer: the next save writes it to disk as before.
        setStamp(id, file, {});
        return false;
      }
      conflicts.set(id, { text, stamp: { ...stampOf(file), hash } });
      patch(id, { state: 'conflict' });
      return false;
    }
    // Record the disk text first, so the save that follows isn't written back.
    setStamp(id, file, { hash });
    await applyText(id, text);
    patch(id, { state: 'synced', error: undefined, refreshedAt: Date.now() });
    return true;
  } catch {
    // A failed check is retried on the next round.
    return false;
  } finally {
    checking.delete(id);
  }
}

function stampOf(file: File): Stamp {
  return { lastModified: file.lastModified, size: file.size };
}

function resolvedQuietly(id: EntryId) {
  conflicts.delete(id);
  patch(id, { state: 'synced', error: undefined });
}

async function sameBytes(a: Blob, b: Blob): Promise<boolean> {
  if (a.size !== b.size) return false;
  const [x, y] = await Promise.all([a.arrayBuffer(), b.arrayBuffer()]);
  const u = new Uint8Array(x);
  const v = new Uint8Array(y);
  for (let i = 0; i < u.length; i++) if (u[i] !== v[i]) return false;
  return true;
}

/** Fresh stamp for a newly linked file, so the first check doesn't re-read it. */
async function initialStamp(id: EntryId, h: PermissionHandle) {
  try {
    const file = await h.getFile();
    const entry = workspace()?.get(id);
    if (binaries.has(id)) setStamp(id, file, { syncedAt: entry?.updatedAt });
    else {
      const text = workspace()?.allTexts().get(id);
      setStamp(id, file, { hash: text === undefined ? undefined : textHash(text) });
    }
  } catch {
    /* checked again later */
  }
}

let timer: ReturnType<typeof setInterval> | null = null;
let lastSweep = 0;

/** Documents worth checking every round: open tabs, or everything on a sweep. */
function idsToCheck(all: boolean): EntryId[] {
  if (all) return [...handles.keys()];
  const { tabs, activeId } = useEditor.getState();
  const open = new Set(tabs);
  if (activeId) open.add(activeId);
  // Binary documents aren't tabs with buffers; the one on screen is in the route.
  const route = useRouter.getState().route;
  if (route.name === 'doc') open.add(route.id);
  return [...open].filter((id) => handles.has(id));
}

async function round(all: boolean) {
  if (typeof document !== 'undefined' && document.hidden) return;
  if (all) lastSweep = Date.now();
  // A few at a time keeps a large linked folder from flooding the disk.
  const ids = idsToCheck(all);
  for (let i = 0; i < ids.length; i += 8) {
    await Promise.all(ids.slice(i, i + 8).map((id) => check(id)));
  }
}

function onFocus() {
  if (Date.now() - lastSweep > SWEEP_MS) void round(true);
  else void round(false);
}

export const diskLinks = {
  /** Loads the links of a workspace (called when a workspace opens). */
  async load(wsId: string, liveIds: (id: EntryId) => boolean): Promise<void> {
    workspaceId = wsId;
    handles.clear();
    binaries.clear();
    stamps.clear();
    conflicts.clear();
    pendingText.clear();
    useDiskLinks.setState({ links: {} });
    if (!canSaveToDisk()) return;
    try {
      const store = (await db()).transaction(STORE).store;
      const links: Record<EntryId, DiskLink> = {};
      for (let c = await store.openCursor(); c; c = await c.continue()) {
        const k = String(c.key);
        if (!k.startsWith(`${wsId}:`)) continue;
        const id = k.slice(wsId.length + 1);
        if (!liveIds(id)) continue;
        const value = c.value as Record_ | PermissionHandle;
        const rec: Record_ = 'handle' in value ? value : { handle: value };
        handles.set(id, rec.handle);
        if (rec.binary) binaries.add(id);
        if (rec.stamp) stamps.set(id, rec.stamp);
        links[id] = { fileName: rec.handle.name, state: 'synced', binary: rec.binary };
      }
      if (workspaceId !== wsId) return;
      useDiskLinks.setState({ links });
      for (const [id, h] of handles) {
        const mode = binaries.has(id) ? 'read' : 'readwrite';
        if ((await permission(h, false, mode)) !== 'granted')
          patch(id, { state: 'needs-permission' });
      }
      // Files changed while My Doc was closed show their new contents right away.
      void round(true);
    } catch {
      // Links are a convenience; the workspace copy is always the source of truth.
    }
  },

  /** Starts watching linked files for changes on disk. Returns a stop function. */
  watch(): () => void {
    if (!canSaveToDisk() || timer) return () => {};
    timer = setInterval(() => void round(false), POLL_MS);
    addEventListener('focus', onFocus);
    document.addEventListener('visibilitychange', onFocus);
    return () => {
      if (timer) clearInterval(timer);
      timer = null;
      removeEventListener('focus', onFocus);
      document.removeEventListener('visibilitychange', onFocus);
    };
  },

  /** Checks one document now (opening it, or the "Check disk" action). */
  check(id: EntryId): Promise<boolean> {
    return check(id);
  },

  /** Links a document to the file it was imported from. */
  async link(id: EntryId, handle: FileSystemFileHandle, opts: { binary?: boolean } = {}) {
    const h = handle as PermissionHandle;
    handles.set(id, h);
    if (opts.binary) binaries.add(id);
    else binaries.delete(id);
    conflicts.delete(id);
    setLink(id, { fileName: h.name, state: 'synced', binary: opts.binary });
    await initialStamp(id, h);
    await persist(id);
  },

  async unlink(id: EntryId): Promise<void> {
    if (!handles.has(id)) return;
    handles.delete(id);
    binaries.delete(id);
    stamps.delete(id);
    conflicts.delete(id);
    pendingText.delete(id);
    setLink(id, null);
    try {
      await (await db()).delete(STORE, key(id));
    } catch {
      /* ignore */
    }
  },

  isLinked(id: EntryId): boolean {
    return handles.has(id);
  },

  /** Writes a document's saved text to its file on disk, if it has one. */
  write(id: EntryId, text: string): Promise<void> {
    if (!handles.has(id) || binaries.has(id)) return Promise.resolve();
    pendingText.set(id, text);
    return schedule(id, false);
  },

  /**
   * Asks for permission (must run from a click) and writes the latest text, if any.
   * Returns whether the file is now in sync.
   */
  async allow(id: EntryId, text?: string): Promise<boolean> {
    const h = handles.get(id);
    if (!h) return false;
    if (binaries.has(id) || text === undefined) {
      const ok = (await permission(h, true, binaries.has(id) ? 'read' : 'readwrite')) === 'granted';
      if (ok) {
        patch(id, { state: 'synced', error: undefined });
        await check(id);
      }
      return ok;
    }
    pendingText.set(id, text);
    await schedule(id, true);
    return stateOf(id) === 'synced';
  },

  /** Ends a "Changed on disk" conflict: take the disk version, or keep My Doc's. */
  async resolve(id: EntryId, keep: 'disk' | 'mine'): Promise<void> {
    const c = conflicts.get(id);
    conflicts.delete(id);
    if (!c) {
      patch(id, { state: 'synced' });
      return;
    }
    if (keep === 'disk') {
      pendingText.delete(id);
      if (c.blob) {
        const updatedAt = await applyBlob(id, c.blob);
        stamps.set(id, { ...c.stamp, syncedAt: updatedAt });
      } else if (c.text !== undefined) {
        stamps.set(id, { ...c.stamp });
        await applyText(id, c.text);
      }
      void persist(id);
      patch(id, { state: 'synced', error: undefined, refreshedAt: Date.now() });
      return;
    }
    // Keep My Doc's version. A text document is written over the file; a binary one stays
    // different from disk until the file changes again.
    if (binaries.has(id)) {
      stamps.set(id, { ...c.stamp, syncedAt: workspace()?.get(id)?.updatedAt });
      void persist(id);
      patch(id, { state: 'synced' });
      return;
    }
    stamps.set(id, { ...c.stamp });
    patch(id, { state: 'synced' });
    const b = useEditor.getState().buffers[id];
    if (b) await editorActions.flush(id);
    const text = localText(id);
    if (text !== undefined) await diskLinks.allow(id, text);
  },

  /**
   * Asks once for permission on freshly picked files, while the click that opened
   * the picker still counts as a user gesture. Stops at the first refusal so a large
   * import never turns into a stack of prompts; the rest ask when first edited.
   */
  async requestAll(ids: EntryId[]): Promise<void> {
    for (const [i, id] of ids.entries()) {
      const h = handles.get(id);
      if (!h) continue;
      const mode = binaries.has(id) ? 'read' : 'readwrite';
      const state = await permission(h, i < MAX_PROMPTS, mode);
      if (state !== 'granted') {
        for (const rest of ids.slice(i)) {
          if (handles.has(rest)) patch(rest, { state: 'needs-permission' });
        }
        return;
      }
    }
  },
};
