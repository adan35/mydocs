import { openDB, type IDBPDatabase } from 'idb';
import { create } from 'zustand';
import type { EntryId } from '@/domain/types';
import { sanitizeName } from '@/domain/names';
import { useApp } from './app-store';
import { diskLinks } from './disk-links';
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
 * files that appeared on disk since are imported into the folder. Nothing is ever
 * deleted: files removed on disk, or deleted or moved in My Doc, stay as they are.
 * Changes to files that are already imported are handled by `disk-links`.
 *
 * Elsewhere (no folder handles) there is no link; import the folder again to add files.
 */

export type FolderLinkState = 'idle' | 'syncing' | 'needs-permission' | 'error';

export interface FolderLink {
  /** Folder name on disk. */
  name: string;
  /** Rescan automatically (on focus and every minute). "Sync now" always works. */
  watch: boolean;
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
  /** Paths (relative to the folder) already looked at: a file deleted in My Doc isn't re-added. */
  seen: string[];
  lastSync?: number;
}

const DB = 'mydoc-folder-links';
const STORE = 'links';
export const FOLDER_POLL_MS = 60_000;
const FOCUS_MS = 10_000;

const records = new Map<EntryId, Record_>();
const running = new Set<EntryId>();
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
    patch(id, { state: 'idle', lastSync: rec.lastSync });
    return {
      added: result.files,
      updated,
      skipped: result.skipped.filter((s) => s.reason !== 'Already exists.').length,
    };
  } catch (err) {
    patch(id, { state: 'error', error: describe(err) });
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

async function sweep() {
  if (typeof document !== 'undefined' && document.hidden) return;
  for (const [id, rec] of records) {
    if (!rec.watch) continue;
    // Quiet: only a folder that gained files says anything.
    report(id, await sync(id, false), true);
  }
}

function onFocus() {
  if (Date.now() - lastFocusSweep < FOCUS_MS) return;
  lastFocusSweep = Date.now();
  void sweep();
}

export const folderSync = {
  /** Loads the folder links of a workspace (called when a workspace opens). */
  async load(wsId: string, liveIds: (id: EntryId) => boolean): Promise<void> {
    workspaceId = wsId;
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
    timer = setInterval(() => void sweep(), FOLDER_POLL_MS);
    addEventListener('focus', onFocus);
    document.addEventListener('visibilitychange', onFocus);
    return () => {
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

  async setWatch(id: EntryId, watch: boolean): Promise<void> {
    const rec = records.get(id);
    if (!rec) return;
    rec.watch = watch;
    patch(id, { watch });
    await persist(id);
  },

  async unlink(id: EntryId): Promise<void> {
    if (!records.delete(id)) return;
    setLink(id, null);
    try {
      await (await db()).delete(STORE, key(id));
    } catch {
      /* ignore */
    }
  },

  isLinked: (id: EntryId) => records.has(id),
};
