/**
 * Only one browser tab may own the workspaces at a time.
 *
 * Every tab keeps the workspace in memory and writes whole entry records, so two
 * tabs editing the same data would silently overwrite each other's changes. The
 * owner holds an exclusive Web Lock; other tabs show "open in another tab" and
 * can ask for a hand-over, which makes the owner save everything and step back.
 */
const LOCK_NAME = 'mydoc-owner';
const CHANNEL_NAME = 'mydoc-owner';

type Message = { type: 'takeover'; requestId: string } | { type: 'denied'; requestId: string };

let releaseLock: (() => void) | null = null;
let channel: BroadcastChannel | null = null;
const takeoverListeners = new Set<() => void | Promise<void>>();
const waiting = new Map<string, () => void>();
let handingOver = false;

const supported = () => typeof navigator !== 'undefined' && !!navigator.locks;

function ensureChannel() {
  if (channel || typeof BroadcastChannel === 'undefined') return;
  channel = new BroadcastChannel(CHANNEL_NAME);
  channel.onmessage = (e: MessageEvent<Message>) => {
    if (e.data?.type === 'denied') {
      waiting.get(e.data.requestId)?.();
      return;
    }
    if (e.data?.type !== 'takeover' || !releaseLock || handingOver) return;
    const requestId = e.data.requestId;
    handingOver = true;
    void (async () => {
      try {
        for (const fn of takeoverListeners) {
          await fn();
        }
        ownership.release();
      } catch (err) {
        console.error(err);
        channel?.postMessage({ type: 'denied', requestId } satisfies Message);
      } finally {
        handingOver = false;
      }
    })();
  };
}

export const ownership = {
  /** True when this tab may write. Browsers without Web Locks always own. */
  get isOwner(): boolean {
    return !supported() || !!releaseLock;
  },

  /**
   * Takes ownership. Without `wait`, resolves false right away if another tab owns it;
   * with `wait`, resolves once the other tab has let go.
   */
  acquire(wait = false, signal?: AbortSignal): Promise<boolean> {
    ensureChannel();
    if (!supported() || releaseLock) return Promise.resolve(true);
    return new Promise<boolean>((resolve) => {
      navigator.locks
        .request(LOCK_NAME, wait ? { signal } : { ifAvailable: true }, (lock) => {
          if (!lock) {
            resolve(false);
            return;
          }
          return new Promise<void>((done) => {
            releaseLock = () => {
              releaseLock = null;
              done();
            };
            resolve(true);
          });
        })
        // A failed request supplies no proof of ownership; do not allow writes.
        .catch(() => resolve(false));
    });
  },

  /** Asks the owning tab to save and step back, then waits for ownership. */
  async takeOver(): Promise<boolean> {
    ensureChannel();
    const requestId = crypto.randomUUID();
    const abort = new AbortController();
    waiting.set(requestId, () => abort.abort());
    const timer = setTimeout(() => abort.abort(), 15_000);
    const granted = ownership.acquire(true, abort.signal);
    channel?.postMessage({ type: 'takeover', requestId } satisfies Message);
    try {
      return await granted;
    } finally {
      clearTimeout(timer);
      waiting.delete(requestId);
    }
  },

  release() {
    releaseLock?.();
  },

  /** Runs before ownership is handed to another tab (save everything here). */
  onTakeover(fn: () => void | Promise<void>): () => void {
    ensureChannel();
    takeoverListeners.add(fn);
    return () => takeoverListeners.delete(fn);
  },
};
