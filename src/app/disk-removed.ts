import type { EntryId } from '@/domain/types';
import { trashEntries } from './actions';
import { useApp } from './app-store';
import { diskLinks, useDiskLinks } from './disk-links';
import { dialogs } from './dialog-store';
import { folderSync, useFolderLinks } from './folder-sync';
import { useSettings } from './settings-store';

/**
 * Files and folders that were deleted on the person's computer. `disk-links` and
 * `folder-sync` only mark them missing; this asks whether to delete them from My Doc too.
 * Deleting moves them to Trash (undoable). Keeping unlinks them, so the document stays as a
 * local copy and nothing keeps trying to save to a file that no longer exists.
 *
 * In a live-synced folder the person can choose to skip the question for files
 * (Settings → "When a file is deleted on disk").
 */

const asked = new Set<EntryId>();
let busy = false;
let again = false;

const workspace = () => useApp.getState().session?.workspace;
const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;

/** The nearest linked folder above an entry. */
function linkedFolderOf(id: EntryId): EntryId | undefined {
  const tree = workspace()?.tree;
  return tree
    ?.ancestors(id)
    .reverse()
    .find((a) => folderSync.isLinked(a.id))?.id;
}

/** After files left a live folder, folders that became empty go too (the disk has no such folder). */
async function pruneEmptyFolders(removed: EntryId[]) {
  const tree = workspace()?.tree;
  if (!tree) return;
  const empty = new Set<EntryId>();
  for (const id of removed) {
    const root = linkedFolderOf(id);
    if (!root || !folderSync.isLive(root)) continue;
    for (let p = tree.parentOf(id); p && p.id !== root; p = tree.parentOf(p.id)) {
      const rest = tree.childrenOf(p.id).filter((c) => !removed.includes(c.id) && !empty.has(c.id));
      if (rest.length) break;
      empty.add(p.id);
    }
  }
  if (empty.size) await trashEntries([...empty]);
}

async function remove(ids: EntryId[]) {
  for (const id of ids) await diskLinks.unlink(id);
  await trashEntries(ids);
  await pruneEmptyFolders(ids);
}

async function run(only?: EntryId[]) {
  const ws = workspace();
  if (!ws) return;
  const live = (id: EntryId) => !!ws.get(id) && !ws.tree.isTrashed(id);

  // A deleted file may only be a deleted folder (or drive): find out before asking about files.
  const candidates = (only ?? diskLinks.missingIds()).filter(live);
  const parents = new Set(candidates.map(linkedFolderOf));
  for (const f of parents) if (f) await folderSync.reachable(f);

  for (const [fid, link] of Object.entries(useFolderLinks.getState().links)) {
    if (link.state !== 'missing' || asked.has(fid) || !live(fid)) continue;
    asked.add(fid);
    const files = diskLinks.linkedIds().filter((f) => ws.tree.isWithin(f, fid));
    const count = ws.tree.liveFiles().filter((f) => ws.tree.isWithin(f.id, fid)).length;
    const yes = await dialogs.confirm({
      title: 'Folder deleted from disk',
      message: `The folder "${link.name}" was deleted from your computer. Delete it from My Doc too, with its ${plural(count, 'file')}? It goes to Trash, so you can restore it.`,
      confirmLabel: 'Delete',
      cancelLabel: 'Keep',
      danger: true,
    });
    for (const f of files) await diskLinks.unlink(f);
    await folderSync.unlink(fid);
    if (yes) await trashEntries([fid]);
  }

  const ids = candidates.filter(
    (id) => diskLinks.isLinked(id) && (only || !asked.has(id)) && live(id),
  );
  ids.forEach((id) => asked.add(id));
  const auto = useSettings.getState().diskDeleteAction === 'remove';
  const silent: EntryId[] = [];
  const ask: EntryId[] = [];
  for (const id of ids) {
    const root = linkedFolderOf(id);
    (auto && !only && root && folderSync.isLive(root) ? silent : ask).push(id);
  }
  if (silent.length) await remove(silent);
  if (!ask.length) return;
  const names = ask.map((id) => ws.get(id)?.name ?? '');
  const yes = await dialogs.confirm({
    title: 'Deleted from disk',
    message:
      ask.length === 1
        ? `"${names[0]}" was deleted from your computer. Delete it from My Doc too? It goes to Trash, so you can restore it. Keep it to leave it here as a copy that is no longer linked to a file.`
        : `${plural(ask.length, 'file')} were deleted from your computer: ${names.slice(0, 5).join(', ')}${names.length > 5 ? '…' : ''}. Delete them from My Doc too? They go to Trash, so you can restore them. Keep them to leave them here as copies that are no longer linked to files.`,
    confirmLabel: 'Delete',
    cancelLabel: 'Keep',
    danger: true,
  });
  if (yes) await remove(ask);
  else for (const id of ask) await diskLinks.unlink(id);
}

/** Runs one question at a time; anything found meanwhile is asked about afterwards. */
async function serial(only?: EntryId[]) {
  if (busy) {
    again = true;
    return;
  }
  busy = true;
  try {
    await run(only);
  } finally {
    busy = false;
    if (again) {
      again = false;
      void serial();
    }
  }
}

export const diskRemoved = {
  /** Asks about these files now (the "Deleted from disk" button). */
  ask: (ids: EntryId[]) => serial(ids),

  /** Asks about whatever was deleted on disk, soon after it is noticed. Returns a stop function. */
  watch(): () => void {
    asked.clear();
    let timer: ReturnType<typeof setTimeout> | undefined;
    // Wait a moment: a scan finds all its missing files before the first question.
    const kick = () => {
      clearTimeout(timer);
      timer = setTimeout(() => void serial(), 800);
    };
    const stops = [
      useDiskLinks.subscribe((s) => {
        if (Object.values(s.links).some((l) => l.state === 'missing')) kick();
      }),
      useFolderLinks.subscribe((s) => {
        if (Object.values(s.links).some((l) => l.state === 'missing')) kick();
      }),
    ];
    return () => {
      clearTimeout(timer);
      stops.forEach((stop) => stop());
    };
  },
};
