import { runImport } from '@/app/actions';
import { IGNORED_SEGMENTS, itemsFromFileList, type ImportItem } from '@/app/importer';
import { canSaveToDisk } from '@/app/disk-links';

type PickerWindow = Window & {
  showOpenFilePicker(opts?: { multiple?: boolean }): Promise<FileSystemFileHandle[]>;
  showDirectoryPicker(opts?: { mode?: 'read' | 'readwrite' }): Promise<FileSystemDirectoryHandle>;
};

/** A picker that aborts sooner than this never showed its dialog. */
const INSTANT_ABORT_MS = 300;

/** Opens the browser's file/folder picker and imports the selection. */
export function pickImport(kind: 'files' | 'folder' | 'zip', targetId?: string | null) {
  const target = targetId === undefined ? undefined : targetId;
  // Where the browser allows it, keep a handle to each picked file so edits are saved
  // back to the original file on disk.
  if (kind !== 'zip' && canSaveToDisk()) {
    const started = performance.now();
    void pickWithHandles(kind).then(
      (items) => items.length && void runImport(items, target),
      (err: unknown) => {
        // Cancelled pickers reject with AbortError. Some browsers (automation-controlled
        // or policy-restricted ones) abort at once without showing a dialog; nobody can
        // cancel a real dialog that fast, so fall back to the input like any other error.
        const cancelled = err instanceof DOMException && err.name === 'AbortError';
        if (!cancelled || performance.now() - started < INSTANT_ABORT_MS)
          pickWithInput(kind, target);
      },
    );
    return;
  }
  pickWithInput(kind, target);
}

function pickWithInput(kind: 'files' | 'folder' | 'zip', targetId?: string | null) {
  const input = document.createElement('input');
  input.type = 'file';
  input.multiple = kind !== 'zip';
  if (kind === 'folder') input.webkitdirectory = true;
  if (kind === 'zip') input.accept = '.zip,application/zip';
  input.style.display = 'none';
  input.addEventListener('change', () => {
    const files = input.files ? itemsFromFileList(input.files) : [];
    input.remove();
    if (files.length) void runImport(files, targetId);
  });
  document.body.append(input);
  input.click();
}

async function pickWithHandles(kind: 'files' | 'folder'): Promise<ImportItem[]> {
  const w = window as unknown as PickerWindow;
  if (kind === 'files') {
    const handles = await w.showOpenFilePicker({ multiple: true });
    return Promise.all(
      handles.map(async (handle) => ({ path: handle.name, file: await handle.getFile(), handle })),
    );
  }
  const root = await w.showDirectoryPicker({ mode: 'readwrite' });
  const out: ImportItem[] = [];
  const walk = async (dir: FileSystemDirectoryHandle, prefix: string): Promise<void> => {
    for await (const child of dir.values()) {
      if (IGNORED_SEGMENTS.has(child.name)) continue;
      if (child.kind === 'file') {
        out.push({ path: prefix + child.name, file: await child.getFile(), handle: child });
      } else {
        await walk(child, `${prefix}${child.name}/`);
      }
    }
  };
  await walk(root, `${root.name}/`);
  return out;
}
