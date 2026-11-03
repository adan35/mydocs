import type { EntryId } from '@/domain/types';
import { diskLinks, useDiskLinks } from './disk-links';
import { folderSync } from './folder-sync';
import { useRouter } from './router';

/**
 * Restores access to the files and folders on disk after a restart with as few browser
 * prompts as possible. Linked folders are asked first: access to a folder covers every file
 * inside it, so a whole imported folder is one prompt. Only files outside linked folders
 * that are in `ask` get a prompt of their own. Must run from a click or key press.
 */
export async function allowDiskAccess(ask: EntryId[] = diskLinks.needingPermission()) {
  if (!(await folderSync.allowFor(ask))) return;
  await diskLinks.allowAll(ask);
}

/** Documents already asked on a gesture this session, so a refusal isn't nagged about. */
const askedOnGesture = new Set<EntryId>();

/** After a restart the first click or key press in a document asks for its permission. */
function onGesture() {
  const route = useRouter.getState().route;
  if (route.name !== 'doc') return;
  if (useDiskLinks.getState().links[route.id]?.state !== 'needs-permission') return;
  if (askedOnGesture.has(route.id)) return;
  askedOnGesture.add(route.id);
  void allowDiskAccess([route.id]);
}

/** Starts asking on the first gesture in a document that needs permission. Returns a stop function. */
export function watchDiskAccess(): () => void {
  document.addEventListener('pointerdown', onGesture, true);
  document.addEventListener('keydown', onGesture, true);
  return () => {
    document.removeEventListener('pointerdown', onGesture, true);
    document.removeEventListener('keydown', onGesture, true);
  };
}
