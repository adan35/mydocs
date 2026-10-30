import { openDB, type IDBPDatabase } from 'idb';
import { create } from 'zustand';
import type { EntryId } from '@/domain/types';
import { sanitizeName } from '@/domain/names';
import { useApp } from './app-store';
import { confirmGone, diskLinks, isGone } from './disk-links';
import { useSettings } from './settings-store';
import {
  IGNORED_SEGMENTS,
  UNREADABLE_REASON,
  importItems,
  itemFromFileHandle,
  type ImportItem,
} from './importer';
import { toast, toastError } from './toast-store';

/**
 * Links between workspace folders and the folders on the user's computer they were
 * imported from (File System Access API: Chrome, Edge, the Windows desktop app). A linked
 * folder is rescanned when the window regains focus and every minute while it is open;
 * files that appeared on disk since are imported into the folder. Files removed on disk are
 * never deleted silently: `disk-links` marks them missing and `disk-removed` asks.
 * Changes to files that are already imported are handled by `disk-links`.
 *
 * A folder with "Sync folder in real time" on (per folder, or the global default in
 * Settings) is rescanned every few seconds instead, and as soon as the browser reports a
 * change where `FileSystemObserver` exists. A scan that takes long is repeated less often.
 *
 * Elsewhere (no folder handles) there is no link; import the folder again to add files.
 */

export type FolderLinkState =
  | 'idle'
  | 'syncing'
  | 'needs-permission'
  | 'error'
  /** The folder was deleted (or moved away) on disk; the person decides what happens to it. */
  | 'missing';

export interface FolderLink {
  /** Folder name on disk. */
  name: string;
  /** Rescan automatically (on focus and every minute). "Sync now" always works. */
  watch: boolean;
  /** Real-time sync chosen for this folder; undefined follows the global default. */
  live?: boolean;
  state: FolderLinkState;
  error?: string;
  lastSync?: number;
}

export const useFolderLinks = create<{ links: Record<EntryId, FolderLink> }>(() => ({
  links: {},
}));

export interface FolderSyncResult {
  added: number;
  /** Already imported files that had changed on disk. */
  updated: number;
  skipped: number;
}

interface DirHandle extends FileSystemDirectoryHandle {
  queryPermission?(d: { mode: 'read' | 'readwrite' }): Promise<PermissionState>;
  requestPermission?(d: { mode: 'read' | 'readwrite' }): Promise<PermissionState>;
}

interface Record_ {
  handle: DirHandle;
  watch: boolean;
  live?: boolean;
  /** Paths (relative to the folder) already looked at: a file deleted in My Doc isn't re-added. */
  seen: string[];
  lastSync?: number;
}

const DB = 'mydoc-folder-links';
const STORE = 'links';
export const FOLDER_POLL_MS = 60_000;
/** Rescan interval of a live folder, and while a change observer watches it. */
export const LIVE_POLL_MS = 5_000;
const OBSERVED_POLL_MS = 30_000;
const FOCUS_MS = 10_000;

const records = new Map<EntryId, Record_>();
const running = new Set<EntryId>();
/** How long the last scan of each folder took, to space out scans of big folders. */
const cost = new Map<EntryId, number>();
const tried = new Map<EntryId, number>();

interface Observer {
  observe(h: FileSystemDirectoryHandle, o?: { recursive?: boolean }): Promise<void>;
  disconnect(): void;
}
const observers = new Map<EntryId, Observer>();
const changed = new Map<EntryId, ReturnType<typeof setTimeout>>();
let workspaceId: string | null = null;
let dbPromise: Promise<IDBPDatabase> | null = null;

const db = () =>
  (dbPromise ??= openDB(DB, 1, {
    upgrade(d) {
      d.createObjectStore(STORE);
    },
  }));
const key = (id: EntryId) => `${workspaceId}:${id}`;

/** Whether this browser can keep a handle to a folder on disk. */
export function canWatchFolders(): boolean {
  return typeof window !== 'undefined' && 'showDirectoryPicker' in window;
}

function setLink(id: EntryId, link: FolderLink | null) {
  useFolderLinks.setState((s) => {
    const links = { ...s.links };
    if (link) links[id] = link;
    else delete links[id];
    return { links };
  });
}

function patch(id: EntryId, p: Partial<FolderLink>) {
  const cur = useFolderLinks.getState().links[id];
  if (cur) setLink(id, { ...cur, ...p });
}

async function persist(id: EntryId) {
  const rec = records.get(id);
  if (!rec || !workspaceId) return;
  try {
    await (await db()).put(STORE, rec, key(id));
  } catch {
    /* the link still works until reload */
  }
}

/** Every file under a folder on disk, with its path relative to the folder. */
export async function listFolder(
  dir: FileSystemDirectoryHandle,
): Promise<{ path: string; handle: FileSystemFileHandle }[]> {
  const out: { path: string; handle: FileSystemFileHandle }[] = [];
  const walk = async (d: DirHandle, prefix: string) => {
    for await (const child of d.values()) {
      if (IGNORED_SEGMENTS.has(child.name)) continue;
      if (child.kind === 'file') out.push({ path: prefix + child.name, handle: child as never });
      else await walk(child as DirHandle, `${prefix}${child.name}/`);
    }
  };
  await walk(dir as DirHandle, '');
  return out;
}

async function granted(h: DirHandle, ask: boolean): Promise<boolean> {
  try {
    if (ask && h.requestPermission)
      return (await h.requestPermission({ mode: 'read' })) === 'granted';
    if (h.queryPermission) return (await h.queryPermission({ mode: 'read' })) === 'granted';
    return true;
  } catch {
    // requestPermission throws without a user gesture.
    return false;
  }
}

function describe(err: unknown): string {
  if (err instanceof DOMException && err.name === 'NotFoundError')
    return 'The folder was moved or deleted on disk.';
  return err instanceof Error ? err.message : 'Unable to read the folder.';
}

/**
 * Imports the files that are new on disk into a linked folder. Returns null when nothing
 * could be scanned (no permission yet, folder gone, or a scan is already running).
 */
async function sync(id: EntryId, ask: boolean): Promise<FolderSyncResult | null> {
  const rec = records.get(id);
  const ws = useApp.getState().session?.workspace;
  if (!rec || !ws || running.has(id)) return null;
  if (!ws.get(id) || ws.tree.isTrashed(id)) return null;
  running.add(id);
  const started = Date.now();
  tried.set(id, started);
  patch(id, { state: 'syncing', error: undefined });
  try {
    if (!(await granted(rec.handle, ask))) {
      patch(id, { state: 'needs-permission' });
      return null;
    }
    const listing = await listFolder(rec.handle);

    // Files already imported that changed on disk since.
    let updated = 0;
    const linked = diskLinks.linkedIds().filter((f) => ws.tree.isWithin(f, id));
    for (let i = 0; i < linked.length; i += 8)
      updated += (await Promise.all(linked.slice(i, i + 8).map((f) => diskLinks.check(f)))).filter(
        Boolean,
      ).length;

    const base = ws.tree.pathOf(id);
    const seen = new Set(rec.seen);
    const fresh = listing.filter(
      (f) =>
        !seen.has(f.path) &&
        !ws.tree.findByPath(
          `${base}/${f.path
            .split('/')
            .map((s) => sanitizeName(s))
            .join('/')}`,
        ),
    );
    const items: ImportItem[] = [];
    for (const f of fresh) items.push(await itemFromFileHandle(f.handle, f.path));
    // Only new files reach the import, so a name clash is one made since the listing: skip it.
    const result = await importItems(ws, id, items, async () => ({
      action: 'skip',
      applyToAll: true,
    }));
    for (const l of result.diskLinks) await diskLinks.link(l.id, l.handle, { binary: l.binary });

    // Files that couldn't be read are tried again next time; everything else is now known.
    const retry = new Set(
      result.skipped.filter((s) => s.reason === UNREADABLE_REASON).map((s) => s.path),
    );
    rec.seen = listing.map((f) => f.path).filter((p) => !retry.has(p));
    rec.lastSync = Date.now();
    void persist(id);
    cost.set(id, Date.now() - started);
    patch(id, { state: 'idle', lastSync: rec.lastSync });
    void observe(id);
    return {
      added: result.files,
      updated,
      skipped: result.skipped.filter((s) => s.reason !== 'Already exists.').length,
    };
  } catch (err) {
    if (isGone(err) && (await confirmGone(() => rec.handle.values().next())))
      patch(id, { state: 'missing', error: describe(err) });
    else patch(id, { state: 'error', error: describe(err) });
    return null;
  } finally {
    running.delete(id);
  }
}

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;

function report(id: EntryId, r: FolderSyncResult | null, quiet: boolean) {
  const link = useFolderLinks.getState().links[id];
  const name = link?.name ?? 'folder';
  if (!r) {
    if (!quiet && link?.state === 'error')
      toastError(
        `Couldn't check "${name}" on disk.`,
        link.error ? new Error(link.error) : undefined,
      );
    return;
  }
  const parts = [];
  if (r.added) parts.push(`${plural(r.added, 'new file')} added`);
  if (r.updated) parts.push(`${plural(r.updated, 'file')} updated`);
  if (!parts.length && quiet) return;
  toast({
    message: parts.length ? `"${name}": ${parts.join(', ')}.` : `"${name}" is up to date.`,
    detail: r.skipped ? `${plural(r.skipped, 'file')} skipped.` : undefined,
    tone: parts.length ? 'success' : 'info',
  });
}

let timer: ReturnType<typeof setInterval> | null = null;
let lastFocusSweep = 0;

/** Whether a folder mirrors the folder on disk in real time. */
export function isLive(id: EntryId): boolean {
  const rec = records.get(id);
  return !!rec && (rec.live ?? useSettings.getState().liveFolderSync);
}

/** Folders due for a scan: all of them (focus, start), or those whose interval has passed. */
async function sweep(all = true) {
  if (typeof document !== 'undefined' && document.hidden) return;
  for (const [id, rec] of records) {
    const live = isLive(id);
    if (!rec.watch && !live) continue;
    // A folder deleted on disk isn't scanned again while the person decides ("Sync now" works).
    if (useFolderLinks.getState().links[id]?.state === 'missing') continue;
    if (!all) {
      const every = live ? (observers.has(id) ? OBSERVED_POLL_MS : LIVE_POLL_MS) : FOLDER_POLL_MS;
      if (Date.now() - (tried.get(id) ?? 0) < Math.max(every, (cost.get(id) ?? 0) * 10) - 500)
        continue;
    }
    // Quiet: only a folder that changed says anything.
    report(id, await sync(id, false), true);
  }
}

function onFocus() {
  if (Date.now() - lastFocusSweep < FOCUS_MS) return;
  lastFocusSweep = Date.now();
  void sweep();
}

/** Rescans soon after the browser reports a change in a live folder (where it can). */
async function observe(id: EntryId) {
  const Observer = (globalThis as { FileSystemObserver?: new (cb: () => void) => Observer })
    .FileSystemObserver;
  const rec = records.get(id);
  if (!rec) return;
  if (!Observer || !isLive(id)) {
    stopObserving(id);
    return;
  }
  if (observers.has(id)) return;
  try {
    const o = new Observer(() => {
      clearTimeout(changed.get(id));
      changed.set(
        id,
        setTimeout(() => {
          changed.delete(id);
          void sync(id, false).then((r) => report(id, r, true));
        }, 400),
      );
    });
    await o.observe(rec.handle, { recursive: true });
    observers.set(id, o);
  } catch {
    // Not supported for this folder: the polling covers it.
  }
}

function stopObserving(id: EntryId) {
  observers.get(id)?.disconnect();
  observers.delete(id);
  clearTimeout(changed.get(id));
  changed.delete(id);
}

export const folderSync = {
  /** Loads the folder links of a workspace (called when a workspace opens). */
  async load(wsId: string, liveIds: (id: EntryId) => boolean): Promise<void> {
    workspaceId = wsId;
    for (const id of [...observers.keys()]) stopObserving(id);
    records.clear();
    useFolderLinks.setState({ links: {} });
    if (!canWatchFolders()) return;
    try {
      const store = (await db()).transaction(STORE).store;
      const links: Record<EntryId, FolderLink> = {};
      for (let c = await store.openCursor(); c; c = await c.continue()) {
        const k = String(c.key);
        if (!k.startsWith(`${wsId}:`)) continue;
        const id = k.slice(wsId.length + 1);
        if (!liveIds(id)) continue;
        const rec = c.value as Record_;
        records.set(id, rec);
        links[id] = {
          name: rec.handle.name,
          watch: rec.watch,
          live: rec.live,
          state: 'idle',
          lastSync: rec.lastSync,
        };
      }
      if (workspaceId !== wsId) return;
      useFolderLinks.setState({ links });
      // Folders that gained files while My Doc was closed.
      void sweep();
    } catch {
      // Links are a convenience; the workspace copy is always the source of truth.
    }
  },

  /** Rescans linked folders on focus and every minute. Returns a stop function. */
  watch(): () => void {
    if (!canWatchFolders() || timer) return () => {};
    // Live folders are due every few seconds; the rest keep their own, longer interval.
    timer = setInterval(() => void sweep(false), LIVE_POLL_MS);
    addEventListener('focus', onFocus);
    document.addEventListener('visibilitychange', onFocus);
    // Turning the global default on or off starts or stops watching the folders that follow it.
    let was = useSettings.getState().liveFolderSync;
    const unsub = useSettings.subscribe((st) => {
      if (st.liveFolderSync === was) return;
      was = st.liveFolderSync;
      for (const id of records.keys()) void observe(id);
      void sweep();
    });
    return () => {
      unsub();
      for (const id of [...observers.keys()]) stopObserving(id);
      if (timer) clearInterval(timer);
      timer = null;
      removeEventListener('focus', onFocus);
      document.removeEventListener('visibilitychange', onFocus);
    };
  },

  /** Links a workspace folder to the folder on disk it was imported from. */
  async link(id: EntryId, handle: FileSystemDirectoryHandle, seen: string[] = []) {
    records.set(id, { handle: handle as DirHandle, watch: true, seen, lastSync: Date.now() });
    setLink(id, { name: handle.name, watch: true, state: 'idle', lastSync: Date.now() });
    await persist(id);
  },

  /** "Sync now": must run from a click, so a permission prompt can show. */
  async syncNow(id: EntryId): Promise<void> {
    report(id, await sync(id, true), false);
  },

  /** Links an existing folder to a folder on disk chosen by the person, then syncs it. */
  async pickAndLink(id: EntryId): Promise<void> {
    const w = window as unknown as {
      showDirectoryPicker(o?: { mode?: 'read' | 'readwrite' }): Promise<FileSystemDirectoryHandle>;
    };
    let handle: FileSystemDirectoryHandle;
    try {
      handle = await w.showDirectoryPicker({ mode: 'readwrite' });
    } catch (err) {
      if (!(err instanceof DOMException && err.name === 'AbortError'))
        toastError('Unable to open the folder.', err);
      return;
    }
    await folderSync.link(id, handle);
    await folderSync.syncNow(id);
  },

  /** "Sync folder in real time" for one folder, overriding the global default. */
  async setLive(id: EntryId, live: boolean): Promise<void> {
    const rec = records.get(id);
    if (!rec) return;
    rec.live = live;
    patch(id, { live });
    await persist(id);
    void observe(id);
    if (live) report(id, await sync(id, false), true);
  },

  async setWatch(id: EntryId, watch: boolean): Promise<void> {
    const rec = records.get(id);
    if (!rec) return;
    rec.watch = watch;
    patch(id, { watch });
    await persist(id);
  },

  /**
   * Whether a linked folder still exists on disk; marks it missing if not. Used before
   * trusting that a single missing file was deleted (and not its whole drive or folder).
   */
  async reachable(id: EntryId): Promise<boolean> {
    const rec = records.get(id);
    if (!rec) return true;
    try {
      await rec.handle.values().next();
      return true;
    } catch (err) {
      if (isGone(err) && (await confirmGone(() => rec.handle.values().next()))) {
        patch(id, { state: 'missing', error: describe(err) });
        return false;
      }
      return true;
    }
  },

  async unlink(id: EntryId): Promise<void> {
    stopObserving(id);
    cost.delete(id);
    tried.delete(id);
    if (!records.delete(id)) return;
    setLink(id, null);
    try {
      await (await db()).delete(STORE, key(id));
    } catch {
      /* ignore */
    }
  },

  isLinked: (id: EntryId) => records.has(id),
  isLive,
};
