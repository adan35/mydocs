import { create } from 'zustand';
import { canSelfUpdate, checkForUpdate, relaunchApp, type PendingUpdate } from '@/platform';
import { editorActions } from './editor-store';
import { toast } from './toast-store';

/** Self-update for the desktop app. Every action is a no-op elsewhere. */

export type UpdateStatus =
  | { phase: 'idle' }
  | { phase: 'checking' }
  | { phase: 'current' }
  | { phase: 'available'; version: string; notes?: string }
  | { phase: 'installing'; version: string; progress: number | null }
  | { phase: 'ready'; version: string }
  | { phase: 'error'; message: string };

interface UpdateState {
  status: UpdateStatus;
  /** Whether the "Update available" dialog is showing. */
  promptOpen: boolean;
}

export const useUpdates = create<UpdateState>(() => ({
  status: { phase: 'idle' },
  promptOpen: false,
}));

const set = (status: UpdateStatus) => useUpdates.setState({ status });

const CHECK_EVERY_MS = 6 * 60 * 60 * 1000;
const FIRST_CHECK_DELAY_MS = 15_000;
const SKIPPED_KEY = 'mydoc.update.skipped';

let pending: PendingUpdate | null = null;

function skippedVersion(): string | null {
  try {
    return localStorage.getItem(SKIPPED_KEY);
  } catch {
    return null;
  }
}

/** Asks the update server whether a newer, correctly signed version exists. */
export async function checkNow(opts: { silent?: boolean } = {}): Promise<void> {
  if (!canSelfUpdate) return;
  const phase = useUpdates.getState().status.phase;
  if (phase === 'checking' || phase === 'installing' || phase === 'ready') return;
  set({ phase: 'checking' });
  try {
    pending = await checkForUpdate();
  } catch (err) {
    console.warn('Update check failed.', err);
    // Background checks stay quiet: offline is normal. A manual check says what happened.
    set(opts.silent ? { phase: 'idle' } : { phase: 'error', message: errorMessage(err) });
    return;
  }
  if (!pending) {
    set({ phase: 'current' });
    return;
  }
  const { version, notes } = pending;
  set({ phase: 'available', version, notes });
  if (!opts.silent || skippedVersion() !== version) useUpdates.setState({ promptOpen: true });
}

function errorMessage(err: unknown): string {
  const text = err instanceof Error ? err.message : String(err);
  return text && text.length < 200 ? text : 'Could not reach the update server.';
}

export function dismissPrompt(skip = false) {
  const s = useUpdates.getState().status;
  if (skip && s.phase === 'available') {
    try {
      localStorage.setItem(SKIPPED_KEY, s.version);
    } catch {
      // Remembering the choice is a nicety.
    }
  }
  useUpdates.setState({ promptOpen: false });
}

/** Saves open edits, then downloads, verifies and installs the update. */
export async function installUpdate(): Promise<void> {
  const s = useUpdates.getState().status;
  if (!pending || s.phase !== 'available') return;
  const { version } = s;
  set({ phase: 'installing', version, progress: null });
  try {
    await editorActions.flushAll();
    await pending.install((progress) => set({ phase: 'installing', version, progress }));
  } catch (err) {
    console.error('Update failed.', err);
    set({ phase: 'error', message: errorMessage(err) });
    toast({
      message: 'The update could not be installed.',
      detail: 'Your documents are untouched. Try again later.',
      tone: 'error',
    });
    return;
  }
  set({ phase: 'ready', version });
  await restartNow();
}

/** Restarts into the installed version. Open edits are saved first. */
export async function restartNow(): Promise<void> {
  await editorActions.flushAll();
  await relaunchApp();
}

/** Checks shortly after launch and every few hours while the app stays open. */
export function startUpdateChecks(): () => void {
  if (!canSelfUpdate) return () => {};
  const first = setTimeout(() => void checkNow({ silent: true }), FIRST_CHECK_DELAY_MS);
  const timer = setInterval(() => void checkNow({ silent: true }), CHECK_EVERY_MS);
  return () => {
    clearTimeout(first);
    clearInterval(timer);
  };
}
