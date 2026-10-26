import { useEffect, useMemo, useState } from 'react';
import { create } from 'zustand';
import type { Entry, EntryId } from '@/domain/types';
import { isMarkdownName } from '@/domain/names';
import { resolvePath, safeDecode } from '@/domain/paths';
import { isValidTag, normalizeTag } from '@/domain/tags';
import {
  bySortKey,
  emptyNote,
  nextReminder,
  noteFileName,
  orderFor,
  orderOnTop,
  parseNote,
  serializeNote,
  type NoteData,
} from '@/domain/notes';
import * as A from './actions';
import { saveAttachment } from './attachments';
import { useApp, ws } from './app-store';
import { dialogs } from './dialog-store';
import { navigate } from './router';
import { prefs } from './prefs';
import { toast, toastError } from './toast-store';

export const NOTES_FOLDER = 'Notes';

export interface Note extends NoteData {
  id: EntryId;
  createdAt: number;
  updatedAt: number;
}

const EMPTY = { live: [] as Note[], trashed: [] as Note[] };
const parsedCache = new Map<EntryId, { text: string; data: NoteData }>();

/** The top-level Notes folder, if the workspace has one. */
export function notesFolder(): Entry | undefined {
  return ws()
    .tree.childrenOf(null)
    .find((e) => e.kind === 'folder' && e.name.toLowerCase() === NOTES_FOLDER.toLowerCase());
}

/** Every Markdown file directly inside the Notes folder, sorted into display order. */
export function readNotes(): { live: Note[]; trashed: Note[] } {
  const folder = notesFolder();
  if (!folder) return EMPTY;
  const { tree } = ws();
  const texts = ws().allTexts();
  const toNote = (e: Entry): Note[] => {
    const text = texts.get(e.id);
    if (e.kind !== 'file' || !isMarkdownName(e.name) || text === undefined) return [];
    let hit = parsedCache.get(e.id);
    if (hit?.text !== text) parsedCache.set(e.id, (hit = { text, data: parseNote(text) }));
    return [{ ...hit.data, id: e.id, createdAt: e.createdAt, updatedAt: e.updatedAt }];
  };
  return {
    live: tree.childrenOf(folder.id).flatMap(toNote).sort(bySortKey),
    trashed: tree
      .rawChildren(folder.id)
      .filter((e) => e.trashedAt !== undefined)
      .flatMap(toNote)
      .sort(bySortKey),
  };
}

/** Re-renders when notes change and returns them. */
export function useNotes() {
  const session = useApp((s) => s.session);
  const treeVersion = useApp((s) => s.treeVersion);
  const indexVersion = useApp((s) => s.indexVersion);
  return useMemo(
    () => (session ? readNotes() : EMPTY),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [session, treeVersion, indexVersion],
  );
}

/** Labels in use, most used first. */
export function labelCounts(notes: readonly Note[]): [string, number][] {
  const counts = new Map<string, number>();
  for (const n of notes) for (const l of n.labels) counts.set(l, (counts.get(l) ?? 0) + 1);
  return [...counts].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
}

/** Turns what a person typed into a valid label, or null. */
export function toLabel(input: string): string | null {
  const l = normalizeTag(input).replace(/\s+/g, '-');
  return isValidTag(l) ? l : null;
}

// ------------------------------------------------------------------ UI state

export type NoteLayout = 'grid' | 'list';

interface NotesUi {
  layout: NoteLayout;
  /** The note open in the editor dialog. */
  openId: EntryId | null;
  /** Quick capture dialog, opened from anywhere. */
  quick: 'note' | 'list' | null;
  selected: EntryId[];
  setLayout(l: NoteLayout): void;
  select(ids: EntryId[]): void;
}

export const useNotesUi = create<NotesUi>((set) => ({
  layout: prefs.get<NoteLayout>('mydoc:notes-layout', 'grid'),
  openId: null,
  quick: null,
  selected: [],
  setLayout(layout) {
    prefs.set('mydoc:notes-layout', layout);
    set({ layout });
  },
  select: (selected) => set({ selected }),
}));

export const openNote = (id: EntryId) => useNotesUi.setState({ openId: id });
export const closeNote = () => useNotesUi.setState({ openId: null });
export const quickNote = (kind: 'note' | 'list' = 'note') => useNotesUi.setState({ quick: kind });
export const showNotes = (view?: 'reminders' | 'archive' | 'trash') =>
  navigate({ name: 'notes', view });

// ------------------------------------------------------------------ changes

async function run<T>(message: string, fn: () => Promise<T>): Promise<T | undefined> {
  try {
    return await fn();
  } catch (err) {
    toastError(err instanceof Error && err.name === 'WorkspaceError' ? err.message : message, err);
    return undefined;
  }
}

/** Creates a note (new notes go first) and attaches any picked image files. */
export function createNote(data: NoteData, files: File[] = []) {
  return run('Unable to save the note.', async () => {
    const folder = await ws().ensureFolder(null, NOTES_FOLDER);
    const order = orderOnTop(readNotes().live);
    const entry = await ws().createFile(
      folder.id,
      noteFileName(data),
      serializeNote({ ...data, order }),
    );
    if (files.length) await addImages(entry.id, files);
    return entry.id;
  });
}

/** Applies a change computed from each note's current content, in one commit. */
export function editNotes(ids: EntryId[], change: (n: NoteData) => Partial<NoteData>) {
  return run('Unable to update the note.', () =>
    ws().updateTexts(ids, (text) => {
      const n = parseNote(text);
      return serializeNote({ ...n, ...change(n) }, text);
    }),
  );
}

export async function patchNotes(ids: EntryId[], patch: Partial<NoteData>) {
  await editNotes(ids, () => patch);
  // A reminder set for the past fires now instead of at the next check.
  if ('reminder' in patch) checkReminders();
}

/** Saves pictures beside the Notes folder and adds them to the note. */
export function addImages(id: EntryId, files: File[]) {
  return run('Unable to add the image.', async () => {
    const hrefs: string[] = [];
    for (const f of files.filter((f) => f.type.startsWith('image/')))
      hrefs.push(/\]\(([^)]+)\)$/.exec(await saveAttachment(id, f))![1]!);
    if (hrefs.length) await editNotes([id], (n) => ({ images: [...n.images, ...hrefs] }));
    return hrefs;
  });
}

/** Renames the file after its title or first line, so the file tree reads like the notes. */
export async function tidyNoteName(id: EntryId) {
  const e = ws().get(id);
  if (!e || e.trashedAt !== undefined) return;
  const data = parseNote(await ws().readText(id));
  const desired = ws().freeName(e.parentId, noteFileName(data, new Date(e.createdAt)), id);
  if (desired !== e.name)
    await ws()
      .rename(id, desired)
      .catch(() => undefined);
}

export async function trashNotes(ids: EntryId[]) {
  useNotesUi.getState().select([]);
  await A.trashEntries(ids);
}

export async function emptyNotesTrash() {
  const ids = readNotes().trashed.map((n) => n.id);
  if (!ids.length) return;
  const ok = await dialogs.confirm({
    title: 'Empty notes Trash?',
    message: `${ids.length} note${ids.length > 1 ? 's' : ''} will be deleted forever. This can't be undone.`,
    confirmLabel: 'Empty Trash',
    danger: true,
  });
  if (ok) await run('Unable to empty the Trash.', () => ws().deletePermanently(ids));
}

export const restoreNotes = (ids: EntryId[]) => A.restoreEntries(ids);

export async function copyNote(id: EntryId) {
  const text = ws().allTexts().get(id);
  if (text === undefined) return;
  const data = parseNote(text);
  const copy = await createNote({ ...data, order: null, reminder: null, repeat: null });
  if (copy) toast({ message: 'Copy created.', tone: 'success' });
}

export function moveNoteToTop(id: EntryId) {
  return patchNotes([id], { order: orderOnTop(readNotes().live) });
}

/** Drops `dragId` next to `targetId`; the order is computed from the visible section. */
export async function reorderNote(
  section: readonly Note[],
  dragId: EntryId,
  targetId: EntryId,
  after: boolean,
) {
  if (dragId === targetId) return;
  await patchNotes([dragId], { order: orderFor(section, dragId, targetId, after) });
}

export function setLabel(ids: EntryId[], label: string, on: boolean) {
  return editNotes(ids, (n) => ({
    labels: on ? [...new Set([...n.labels, label])] : n.labels.filter((l) => l !== label),
  }));
}

export async function createLabelFor(ids: EntryId[]) {
  const input = await dialogs.prompt({
    title: 'New label',
    label: 'Label name',
    confirmLabel: 'Create',
    validate: (v) => (toLabel(v) ? null : 'Use letters or numbers; spaces become dashes.'),
  });
  const label = input && toLabel(input);
  if (label) await setLabel(ids, label, true);
  return label || null;
}

export async function renameLabel(from: string) {
  const input = await dialogs.prompt({
    title: `Rename label "${from}"`,
    label: 'Label name',
    initial: from,
    confirmLabel: 'Rename',
    validate: (v) => (toLabel(v) ? null : 'Use letters or numbers; spaces become dashes.'),
  });
  const to = input && toLabel(input);
  if (!to || to === from) return;
  const { live, trashed } = readNotes();
  const ids = [...live, ...trashed].filter((n) => n.labels.includes(from)).map((n) => n.id);
  await editNotes(ids, (n) => ({
    labels: [...new Set(n.labels.map((l) => (l === from ? to : l)))],
  }));
}

export async function deleteLabel(label: string) {
  const ok = await dialogs.confirm({
    title: `Delete label "${label}"?`,
    message: 'The label is removed from every note. The notes themselves stay.',
    confirmLabel: 'Delete label',
    danger: true,
  });
  if (!ok) return;
  const { live, trashed } = readNotes();
  const ids = [...live, ...trashed].filter((n) => n.labels.includes(label)).map((n) => n.id);
  await setLabel(ids, label, false);
}

// ------------------------------------------------------------------ images

const imageUrls = new Map<EntryId, string>();

/** The object URL of a note picture, or undefined while loading or when it is missing. */
export function useNoteImage(href: string): string | undefined {
  const [url, setUrl] = useState<string>();
  const session = useApp((s) => s.session);
  useEffect(() => {
    let live = true;
    const folder = session && notesFolder();
    const path = folder && resolvePath(ws().tree.pathOf(folder.id), safeDecode(href));
    const entry = path ? ws().tree.findByPath(path) : undefined;
    if (!entry) return setUrl(undefined);
    const cached = imageUrls.get(entry.id);
    if (cached) return setUrl(cached);
    void ws()
      .readBlob(entry.id)
      .then((blob) => {
        // shortcut: object URLs live until the page closes; fine for a few pictures per note.
        if (!blob || !live) return;
        const made = imageUrls.get(entry.id) ?? URL.createObjectURL(blob);
        imageUrls.set(entry.id, made);
        setUrl(made);
      });
    return () => {
      live = false;
    };
  }, [href, session]);
  return url;
}

// ------------------------------------------------------------------ reminders

const firedKey = () => `mydoc:notes-fired:${ws().id}`;

/** Fires due reminders: a toast, plus a system notification when allowed. Repeats roll forward. */
export function checkReminders(now = Date.now()) {
  const { live } = readNotes();
  const fired = prefs.get<Record<EntryId, number>>(firedKey(), {});
  const due = live.filter(
    (n) => n.reminder !== null && n.reminder <= now && fired[n.id] !== n.reminder,
  );
  if (!due.length) return;
  const next: Record<EntryId, number> = {};
  for (const n of live) if (fired[n.id] !== undefined) next[n.id] = fired[n.id]!;
  for (const n of due) next[n.id] = n.reminder!;
  prefs.set(firedKey(), next);
  for (const n of due) {
    const what = n.title || n.text.split('\n')[0] || n.items?.[0]?.text || 'Note';
    try {
      if (typeof Notification !== 'undefined' && Notification.permission === 'granted')
        new Notification('Reminder', { body: what });
    } catch {
      /* some webviews lack the Notification constructor */
    }
    if (n.repeat) void patchNotes([n.id], { reminder: nextReminder(n.reminder!, n.repeat, now) });
  }
  toast(
    due.length === 1
      ? {
          message: `Reminder: ${due[0]!.title || 'Note'}`,
          action: { label: 'Open', run: () => openNote(due[0]!.id) },
          duration: 15_000,
        }
      : {
          message: `${due.length} note reminders are due.`,
          action: { label: 'Show', run: () => showNotes('reminders') },
          duration: 15_000,
        },
  );
}

/** Asks for permission to show system notifications; called from the click that sets a reminder. */
export function askNotificationPermission() {
  try {
    if (typeof Notification !== 'undefined' && Notification.permission === 'default')
      void Notification.requestPermission();
  } catch {
    /* ignore */
  }
}

/** Checks reminders while the app is open (no server: nothing fires when it is closed). */
export function useNoteReminders() {
  const ready = useApp((s) => s.phase === 'ready' && !!s.session);
  useEffect(() => {
    if (!ready) return;
    const t = setTimeout(() => checkReminders(), 1500);
    const i = setInterval(() => checkReminders(), 30_000);
    return () => {
      clearTimeout(t);
      clearInterval(i);
    };
  }, [ready]);
}

export { emptyNote };
