/**
 * Helpers for restoring access to many linked files and folders at once without freezing
 * the page or stacking browser prompts.
 */

/** Real browser prompts one click may start. A prompt needs a fresh click, so more would fail part-way. */
export const MAX_ASK = 3;
/** How long to wait for an answer to a browser prompt before carrying on without it. */
export const PROMPT_WAIT_MS = 30_000;

/** Runs `fn` over `items` a few at a time, yielding to the page between batches. */
export async function inChunks<T>(
  items: readonly T[],
  size: number,
  fn: (item: T) => Promise<void>,
): Promise<void> {
  for (let i = 0; i < items.length; i += size) {
    await Promise.all(items.slice(i, i + size).map(fn));
    await new Promise((r) => setTimeout(r));
  }
}

/** The value of `p`, or null if it takes longer than `ms` (a prompt nobody answered). */
export function orTimeout<T>(p: Promise<T>, ms = PROMPT_WAIT_MS): Promise<T | null> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(null), ms);
    void p.then(
      (v) => {
        clearTimeout(timer);
        resolve(v);
      },
      () => {
        clearTimeout(timer);
        resolve(null);
      },
    );
  });
}

/**
 * A function that finds the same file or folder again through `root` (a folder the person
 * just allowed). The handle it returns carries `root`'s permission, whatever the browser
 * remembers about the old one. Gives null for anything that isn't inside `root`.
 */
export function reacher(root: FileSystemDirectoryHandle) {
  const dirs = new Map<string, Promise<FileSystemDirectoryHandle>>([['', Promise.resolve(root)]]);
  const dir = (parts: string[]): Promise<FileSystemDirectoryHandle> => {
    const k = parts.join('/');
    let p = dirs.get(k);
    if (!p) {
      p = dir(parts.slice(0, -1)).then((d) => d.getDirectoryHandle(parts[parts.length - 1]!));
      dirs.set(k, p);
    }
    return p;
  };
  return async (h: FileSystemHandle): Promise<FileSystemHandle | null> => {
    try {
      const path = await root.resolve(h);
      if (!path) return null;
      if (!path.length) return root;
      const parent = await dir(path.slice(0, -1));
      const name = path[path.length - 1]!;
      return h.kind === 'file'
        ? await parent.getFileHandle(name)
        : await parent.getDirectoryHandle(name);
    } catch {
      return null;
    }
  };
}
