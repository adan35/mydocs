import { create } from 'zustand';
import type { EntryId, WorkspaceInfo } from '@/domain/types';
import type { WorkspaceProvider } from '@/storage/types';
import { IndexedDbProvider } from '@/storage/indexeddb';
import { Workspace, setWriteGuard } from './workspace';
import { ownership } from './ownership';
import { WorkspaceSession } from './session';
import { prefs } from './prefs';
import { seedWorkspace } from './seed';
import { navigate, useRouter } from './router';
import { useUi } from './ui-store';

export interface RecentItem {
  id: EntryId;
  at: number;
}

interface AppState {
  /** `elsewhere`: another browser tab owns the data (see ownership.ts). */
  phase: 'loading' | 'ready' | 'error' | 'elsewhere';
  error?: string;
  provider: WorkspaceProvider;
  workspaces: WorkspaceInfo[];
  session: WorkspaceSession | null;
  /** Bumps whenever the tree changes, so components re-derive from `session.workspace.tree`. */
  treeVersion: number;
  /** Bumps whenever derived indexes (search, tags, links) change. */
  indexVersion: number;
  recents: RecentItem[];
  /** How often each document was opened, for ranking quick open. */
  openCounts: Record<EntryId, number>;
  expanded: Record<EntryId, true>;
  persistentStorage: boolean | null;
}

const RECENTS_LIMIT = 30;
let initPromise: Promise<void> | null = null;
const LAST_WS_KEY = 'mydoc:last-workspace';
const recentsKey = (ws: string) => `mydoc:recents:${ws}`;
const frequencyKey = (ws: string) => `mydoc:open-counts:${ws}`;
const FREQUENCY_LIMIT = 500;
const expandedKey = (ws: string) => `mydoc:expanded:${ws}`;

export const useApp = create<AppState>(() => ({
  phase: 'loading',
  provider: new IndexedDbProvider(),
  workspaces: [],
  session: null,
  treeVersion: 0,
  indexVersion: 0,
  recents: [],
  openCounts: {},
  expanded: {},
  persistentStorage: null,
}));

const get = useApp.getState;
const set = useApp.setState;

/** The open workspace. Throws if none is open: callers run after init. */
export function ws(): Workspace {
  const s = get().session;
  if (!s) throw new Error('No workspace is open.');
  return s.workspace;
}

export function session(): WorkspaceSession {
  const s = get().session;
  if (!s) throw new Error('No workspace is open.');
  return s;
}

async function openSession(info: WorkspaceInfo) {
  const store = await get().provider.open(info.id);
  const workspace = await Workspace.open(store);
  const next = new WorkspaceSession(workspace);
  workspace.subscribe((e) => {
    if (e.type === 'tree') set((s) => ({ treeVersion: s.treeVersion + 1 }));
  });
  next.onIndexChange(() => set((s) => ({ indexVersion: s.indexVersion + 1 })));
  get().session?.dispose();
  prefs.set(LAST_WS_KEY, info.id);
  set({
    session: next,
    treeVersion: get().treeVersion + 1,
    recents: prefs.get<RecentItem[]>(recentsKey(info.id), []),
    openCounts: prefs.get<Record<EntryId, number>>(frequencyKey(info.id), {}),
    expanded: prefs.get<Record<EntryId, true>>(expandedKey(info.id), {}),
  });
  return next;
}

export const appActions = {
  setProvider(provider: WorkspaceProvider) {
    set({ provider });
  },

  init(): Promise<void> {
    // Idempotent: React StrictMode and retries may call this more than once.
    if (get().phase === 'ready') return Promise.resolve();
    initPromise ??= appActions.doInit().finally(() => {
      initPromise = null;
    });
    return initPromise;
  },

  async doInit() {
    try {
      set({ phase: 'loading', error: undefined });
      if (!(await ownership.acquire())) {
        set({ phase: 'elsewhere' });
        return;
      }
      setWriteGuard(() => ownership.isOwner);
      const provider = get().provider;
      let workspaces = await provider.list();
      let fresh = false;
      if (!workspaces.length) {
        await provider.create('My Workspace');
        workspaces = await provider.list();
        fresh = true;
      }
      set({ workspaces });
      const last = prefs.get<string | null>(LAST_WS_KEY, null);
      const info = workspaces.find((w) => w.id === last) ?? workspaces[0]!;
      const s = await openSession(info);
      if (fresh) {
        const welcome = await seedWorkspace(s.workspace);
        // First launch opens the welcome guide, rendered.
        if (useRouter.getState().route.name === 'home') {
          useUi.getState().setViewMode(welcome.id, 'preview');
          navigate({ name: 'doc', id: welcome.id }, { replace: true });
        }
      }
      set({ phase: 'ready' });
      void requestPersistence();
    } catch (err) {
      console.error(err);
      set({
        phase: 'error',
        error:
          err instanceof Error && err.name === 'StorageError'
            ? err.message
            : 'My Doc could not open its local storage. This can happen in private browsing or when site data is blocked.',
      });
    }
  },

  /** Called after this tab saved everything and is handing the data to another tab. */
  relinquish() {
    set({ phase: 'elsewhere' });
  },

  /** Takes the data back from the tab that owns it, then reloads from storage. */
  async takeOver() {
    set({ phase: 'loading' });
    await ownership.takeOver();
    get().session?.dispose();
    set({ session: null });
    await appActions.init();
  },

  async switchWorkspace(id: string) {
    const info = get().workspaces.find((w) => w.id === id);
    if (!info || info.id === get().session?.workspace.id) return;
    await openSession(info);
  },

  async createWorkspace(name: string) {
    const provider = get().provider;
    const info = await provider.create(name);
    set({ workspaces: await provider.list() });
    await openSession(info);
    return info;
  },

  async renameWorkspace(id: string, name: string) {
    const provider = get().provider;
    await provider.rename(id, name);
    set({ workspaces: await provider.list() });
    const s = get().session;
    if (s && s.workspace.id === id) {
      (s.workspace.store.info as { name: string }).name = name;
      set((st) => ({ treeVersion: st.treeVersion + 1 }));
    }
  },

  async deleteWorkspace(id: string) {
    const provider = get().provider;
    const current = get().session?.workspace.id === id;
    if (current) {
      get().session?.dispose();
      set({ session: null });
    }
    await provider.remove(id);
    prefs.remove(recentsKey(id));
    prefs.remove(frequencyKey(id));
    prefs.remove(expandedKey(id));
    let workspaces = await provider.list();
    if (!workspaces.length) {
      await provider.create('My Workspace');
      workspaces = await provider.list();
    }
    set({ workspaces });
    if (current) await openSession(workspaces[0]!);
  },

  touchRecent(id: EntryId) {
    const s = get().session;
    if (!s) return;
    const recents = [{ id, at: Date.now() }, ...get().recents.filter((r) => r.id !== id)].slice(
      0,
      RECENTS_LIMIT,
    );
    const counts = { ...get().openCounts, [id]: (get().openCounts[id] ?? 0) + 1 };
    // Keep the map bounded: drop the least-opened documents.
    const entries = Object.entries(counts);
    const openCounts =
      entries.length > FREQUENCY_LIMIT
        ? Object.fromEntries(entries.sort((a, b) => b[1] - a[1]).slice(0, FREQUENCY_LIMIT))
        : counts;
    set({ recents, openCounts });
    prefs.set(recentsKey(s.workspace.id), recents);
    prefs.set(frequencyKey(s.workspace.id), openCounts);
  },

  setExpanded(id: EntryId, open: boolean) {
    const s = get().session;
    if (!s) return;
    const expanded = { ...get().expanded };
    if (open) expanded[id] = true;
    else delete expanded[id];
    set({ expanded });
    prefs.set(expandedKey(s.workspace.id), expanded);
  },

  /** Expands every ancestor so an entry is visible in the tree. */
  reveal(id: EntryId) {
    const s = get().session;
    if (!s) return;
    const ancestors = s.workspace.tree.ancestors(id);
    if (ancestors.every((a) => get().expanded[a.id])) return;
    const expanded = { ...get().expanded };
    for (const a of ancestors) expanded[a.id] = true;
    set({ expanded });
    prefs.set(expandedKey(s.workspace.id), expanded);
  },
};

/** Asks the browser not to evict our data under storage pressure. */
async function requestPersistence() {
  try {
    if (!navigator.storage?.persist) return;
    const already = await navigator.storage.persisted();
    set({ persistentStorage: already || (await navigator.storage.persist()) });
  } catch {
    set({ persistentStorage: false });
  }
}
