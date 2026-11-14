import type { EntryId } from '@/domain/types';
import { diskLinks, useDiskLinks } from './disk-links';
import { folderSync, useFolderLinks } from './folder-sync';
import { useRouter } from './router';
import { toast, toastError } from './toast-store';

/**
 * Restores access to the files and folders on disk after a restart with as few browser
 * prompts as possible. Linked folders are asked first: access to a folder covers every file
 * inside it. Only files outside linked folders that are in `ask` get a prompt of their own.
 * With `ask` given (one document) only the folder holding it is asked. At most a few prompts
 * run per call; `allowAllDiskAccess` handles any number. Must run from a click or key press.
 */
export async function allowDiskAccess(ask?: EntryId[]): Promise<boolean> {
  if (!(await folderSync.allowFor(ask ?? diskLinks.needingPermission(), !!ask))) return false;
  return diskLinks.allowAll(ask);
}

/** What the browser will ask for: one prompt per folder, plus one per file outside a folder. */
export function accessPlan() {
  const folders = Object.entries(useFolderLinks.getState().links)
    .filter(([, l]) => l.state === 'needs-permission')
    .map(([id, l]) => ({ id, name: l.name }));
  const links = useDiskLinks.getState().links;
  const needing = diskLinks.needingPermission();
  const files = needing
    .filter((id) => !folderSync.covers(id))
    .map((id) => ({ id, name: links[id]!.fileName }));
  return {
    folders,
    files,
    prompts: folders.length + files.length,
    /** Every linked file and folder waiting for permission. */
    items: folders.length + needing.length,
  };
}

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;

/**
 * "Allow all": one click, one browser step. With a single folder or file waiting, that is
 * its own prompt. With more, the person picks the folder that contains them (a projects
 * folder, a drive) and allows it once; everything inside it is restored from that one
 * permission. Whatever lies elsewhere stays listed so they can pick another folder.
 * Browsers allow one prompt per click and file, so this is the least that can be asked.
 * Must run from a click or key press.
 */
export async function allowAllDiskAccess(): Promise<void> {
  const before = accessPlan();
  if (!before.items) return;
  const pick = (window as unknown as { showDirectoryPicker?: DirectoryPicker }).showDirectoryPicker;
  if (before.prompts <= 1 || !pick) {
    await allowDiskAccess();
  } else {
    let root: FileSystemDirectoryHandle;
    try {
      // The same start place as last time, so choosing the parent again is a single click.
      root = await pick({ mode: 'readwrite', id: 'mydoc-allow-all' });
    } catch (err) {
      if (!(err instanceof DOMException && err.name === 'AbortError'))
        toastError('Unable to open the folder.', err);
      return;
    }
    await allowRoot(root);
  }
  const left = accessPlan();
  const done = before.items - left.items;
  if (!left.items) {
    toast({ tone: 'success', message: `Allowed access to ${plural(done, 'linked item')}.` });
  } else if (done > 0 || before.prompts > 1) {
    toast({
      tone: 'info',
      message: `Allowed ${done} of ${before.items} linked items.`,
      detail: `${left.items} ${left.items === 1 ? 'is' : 'are'} outside the folder you chose. They ask when you edit them, or choose another folder.`,
      action: { label: 'Choose another folder', run: () => void allowAllDiskAccess() },
      duration: 12_000,
    });
  }
}

type DirectoryPicker = (o: {
  mode: 'readwrite';
  id?: string;
}) => Promise<FileSystemDirectoryHandle>;

/** Makes sure the chosen folder can be written, then restores everything inside it. */
async function allowRoot(root: FileSystemDirectoryHandle) {
  const h = root as FileSystemDirectoryHandle & {
    queryPermission?(d: { mode: 'readwrite' }): Promise<PermissionState>;
    requestPermission?(d: { mode: 'readwrite' }): Promise<PermissionState>;
  };
  try {
    if ((await h.queryPermission?.({ mode: 'readwrite' })) !== 'granted')
      await h.requestPermission?.({ mode: 'readwrite' });
  } catch {
    /* read-only access still restores what only needs reading */
  }
  await folderSync.adoptUnder(root);
  await diskLinks.adoptUnder(root);
}

/** Documents already asked on a gesture this session, so a refusal isn't nagged about. */
const askedOnGesture = new Set<EntryId>();
/** Off after a refusal: nothing asks again until the person chooses to. */
let gestureAsks = true;

/** A key press that changes the document. */
function isEditKey(e: Event) {
  const k = e as KeyboardEvent;
  if (e.type !== 'keydown' || k.ctrlKey || k.metaKey || k.altKey) return false;
  return k.key.length === 1 || ['Backspace', 'Delete', 'Enter'].includes(k.key);
}

/**
 * After a restart a document asks for its permission on the first click or key press only
 * when one prompt restores many files (the document is in a linked folder). Any other file
 * waits until the person starts editing it, so opening tabs never stacks prompts.
 */
function onGesture(e: Event) {
  if (!gestureAsks) return;
  const route = useRouter.getState().route;
  if (route.name !== 'doc') return;
  if (useDiskLinks.getState().links[route.id]?.state !== 'needs-permission') return;
  if (askedOnGesture.has(route.id)) return;
  if (!folderSync.covers(route.id) && !isEditKey(e)) return;
  askedOnGesture.add(route.id);
  void allowDiskAccess([route.id]).then((ok) => {
    if (!ok) gestureAsks = false;
  });
}

/** Starts asking on the first gesture in a document that needs permission. Returns a stop function. */
export function watchDiskAccess(): () => void {
  gestureAsks = true;
  document.addEventListener('pointerdown', onGesture, true);
  document.addEventListener('keydown', onGesture, true);
  return () => {
    document.removeEventListener('pointerdown', onGesture, true);
    document.removeEventListener('keydown', onGesture, true);
  };
}
