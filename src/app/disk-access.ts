import type { EntryId } from '@/domain/types';
import { diskLinks, useDiskLinks } from './disk-links';
import { folderSync, useFolderLinks } from './folder-sync';
import { useRouter } from './router';

/**
 * Restores access to the files and folders on disk after a restart with as few browser
 * prompts as possible. Linked folders are asked first: access to a folder covers every file
 * inside it, so a whole imported folder is one prompt. Only files outside linked folders
 * that are in `ask` get a prompt of their own. Must run from a click or key press.
 */
export async function allowDiskAccess(
  ask: EntryId[] = diskLinks.needingPermission(),
): Promise<boolean> {
  if (!(await folderSync.allowFor(ask))) return false;
  return diskLinks.allowAll(ask);
}

/** What the browser will ask for: one prompt per folder, plus one per file outside a folder. */
export function accessPlan() {
  const folders = Object.entries(useFolderLinks.getState().links)
    .filter(([, l]) => l.state === 'needs-permission')
    .map(([id, l]) => ({ id, name: l.name }));
  const links = useDiskLinks.getState().links;
  const files = diskLinks
    .needingPermission()
    .filter((id) => !folderSync.covers(id))
    .map((id) => ({ id, name: links[id]!.fileName }));
  return { folders, files, prompts: folders.length + files.length };
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
