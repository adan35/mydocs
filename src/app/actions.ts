import type { Entry, EntryId } from '@/domain/types';
import {
  NAME_ERROR_MESSAGES,
  baseName,
  extensionOf,
  isMarkdownName,
  validateName,
} from '@/domain/names';
import {
  TEMPLATES,
  expandTemplate,
  isoDate,
  templateFromFile,
  type Template,
} from '@/domain/templates';
import { isValidTag, normalizeTag } from '@/domain/tags';
import { appActions, session, useApp, ws } from './app-store';
import { dialogs } from './dialog-store';
import { editorActions, useEditor } from './editor-store';
import { navigate, useRouter } from './router';
import { toast, toastError, useToasts } from './toast-store';
import { useUi } from './ui-store';
import { useSettings } from './settings-store';
import { exportFile, exportHtml, exportText, exportZip } from './exporter';
import { importItems, type ImportItem } from './importer';
import { canPrint } from '@/platform';
import { diskLinks } from './disk-links';

/**
 * User-facing commands. Each one handles its own confirmation, errors and
 * feedback, so menus, shortcuts and the command palette can all call them.
 */

const nameValidator = (value: string) => {
  const err = validateName(value);
  return err ? NAME_ERROR_MESSAGES[err] : null;
};

/** The folder new items go into: the current folder view or the active doc's folder. */
export function contextFolderId(): EntryId | null {
  const route = useRouter.getState().route;
  const tree = ws().tree;
  if (route.name === 'folder')
    return route.id && tree.get(route.id) && !tree.isTrashed(route.id) ? route.id : null;
  const active = useEditor.getState().activeId;
  if (route.name === 'doc' && active) return tree.get(active)?.parentId ?? null;
  return null;
}

export async function openEntry(id: EntryId, anchor?: string) {
  const e = ws().get(id);
  if (!e) return;
  useUi.getState().setDrawer(false);
  if (e.kind === 'folder') {
    navigate({ name: 'folder', id });
    return;
  }
  appActions.touchRecent(id);
  appActions.reveal(id);
  await editorActions.open(id);
  navigate({ name: 'doc', id, anchor });
}

async function guard<T>(message: string, fn: () => Promise<T>): Promise<T | undefined> {
  try {
    return await fn();
  } catch (err) {
    toastError(err instanceof Error && err.name === 'WorkspaceError' ? err.message : message, err);
    return undefined;
  }
}

export const TEMPLATES_FOLDER = 'Templates';

/** The top-level "Templates" folder, if the workspace has one. */
export function templatesFolder(): Entry | undefined {
  const tree = ws().tree;
  return tree
    .childrenOf(null)
    .find((e) => e.kind === 'folder' && e.name.toLowerCase() === TEMPLATES_FOLDER.toLowerCase());
}

/** Markdown files in the Templates folder are templates too; they come first. */
export function workspaceTemplates(): Template[] {
  const folder = templatesFolder();
  if (!folder) return [];
  const tree = ws().tree;
  return tree
    .childrenOf(folder.id)
    .filter((e) => e.kind === 'file' && isMarkdownName(e.name))
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((e) =>
      templateFromFile(`user:${e.id}`, baseName(e.name), ws().allTexts().get(e.id) ?? ''),
    );
}

export async function newDocument(
  parentId: EntryId | null = contextFolderId(),
  templateId?: string,
) {
  const template =
    [...workspaceTemplates(), ...TEMPLATES].find((t) => t.id === (templateId ?? 'blank')) ??
    TEMPLATES[0]!;
  const title = expandTemplate(template.fileName, { title: '' }) || 'Untitled';
  // Keys typed while the document is created must not press the "New document" button again.
  if (document.activeElement instanceof HTMLButtonElement) document.activeElement.blur();
  return guard('Unable to create the document.', async () => {
    const name = ws().freeName(parentId, `${title}.md`);
    const body = expandTemplate(template.body, { title: baseName(name), date: isoDate() });
    const entry = await ws().createFile(parentId, name, body);
    if (parentId) appActions.setExpanded(parentId, true);
    // A new document is for writing: open it in the editor with the cursor in place.
    if (useSettings.getState().defaultViewMode === 'preview')
      useUi.getState().setViewMode(entry.id, 'edit');
    editorActions.requestFocus(entry.id, { end: true });
    await openEntry(entry.id);
    return entry;
  });
}

export async function newFromTemplate(parentId: EntryId | null = contextFolderId()) {
  const id = await dialogs.template();
  if (id) return newDocument(parentId, id);
}

/**
 * Opens today's note (YYYY-MM-DD.md in the daily notes folder), creating it from
 * the daily template if needed.
 */
export async function openDailyNote() {
  const date = isoDate();
  return guard("Unable to open today's note.", async () => {
    let parentId: EntryId | null = null;
    const segments = useSettings
      .getState()
      .dailyFolder.split('/')
      .map((s) => s.trim())
      .filter(Boolean);
    for (const seg of segments) parentId = (await ws().ensureFolder(parentId, seg)).id;
    const tree = ws().tree;
    const existing = tree
      .childrenOf(parentId)
      .find((e) => e.kind === 'file' && e.name.toLowerCase() === `${date}.md`);
    if (existing) {
      editorActions.requestFocus(existing.id, { end: true });
      await openEntry(existing.id);
      return existing;
    }
    const template = TEMPLATES.find((t) => t.id === 'daily')!;
    const entry = await ws().createFile(
      parentId,
      `${date}.md`,
      expandTemplate(template.body, { title: date, date }),
      { uniquify: false },
    );
    if (parentId) appActions.setExpanded(parentId, true);
    if (useSettings.getState().defaultViewMode === 'preview')
      useUi.getState().setViewMode(entry.id, 'edit');
    editorActions.requestFocus(entry.id, { end: true });
    await openEntry(entry.id);
    return entry;
  });
}

/** Copies a document into the Templates folder so it shows up in "New from template". */
export async function saveAsTemplate(id: EntryId) {
  const e = ws().get(id);
  if (!e) return;
  await editorActions.flush(id);
  return guard('Unable to save the template.', async () => {
    const folder = templatesFolder() ?? (await ws().createFolder(null, TEMPLATES_FOLDER));
    const text = await ws().readText(id);
    const entry = await ws().createFile(folder.id, e.name, text);
    toast({
      message: `Saved "${baseName(entry.name)}" as a template.`,
      detail: 'Use {{title}}, {{date}} and {{time}} for values filled in when you use it.',
      tone: 'success',
      action: { label: 'Open', run: () => void openEntry(entry.id) },
    });
    return entry;
  });
}

export async function newFolder(parentId: EntryId | null = contextFolderId()) {
  const name = await dialogs.prompt({
    title: 'New folder',
    label: 'Folder name',
    initial: ws().freeName(parentId, 'New folder'),
    confirmLabel: 'Create',
    validate: nameValidator,
  });
  if (!name) return;
  return guard('Unable to create the folder.', async () => {
    const entry = await ws().createFolder(parentId, name);
    if (parentId) appActions.setExpanded(parentId, true);
    return entry;
  });
}

export async function renameEntry(id: EntryId) {
  const e = ws().get(id);
  if (!e) return;
  const ext = e.kind === 'file' ? extensionOf(e.name) : '';
  const name = await dialogs.prompt({
    title: e.kind === 'folder' ? 'Rename folder' : 'Rename',
    label: 'Name',
    initial: e.name,
    confirmLabel: 'Rename',
    selectRange: [0, ext ? e.name.length - ext.length - 1 : e.name.length],
    validate: nameValidator,
  });
  if (!name || name === e.name) return;
  return renameTo(id, await keepExtension(e.name, name));
}

/**
 * Typing a name without an extension keeps the current one, so "Notes" stays a
 * Markdown document. Changing the extension on purpose asks first, because it
 * changes how the file opens.
 */
async function keepExtension(oldName: string, newName: string): Promise<string> {
  const oldExt = extensionOf(oldName);
  if (!oldExt) return newName;
  const newExt = extensionOf(newName);
  // "Report 2.0" or "v1.final" have a dot but no real extension.
  if (!/^[a-z][a-z0-9]{0,7}$/.test(newExt)) return `${newName}.${oldExt}`;
  if (newExt.toLowerCase() === oldExt.toLowerCase()) return newName;
  const ok = await dialogs.confirm({
    title: `Change the file type to .${newExt}?`,
    message: `"${newName}" will no longer open as a .${oldExt} file. Keep .${oldExt} to leave it as it is.`,
    confirmLabel: `Use .${newExt}`,
    cancelLabel: `Keep .${oldExt}`,
  });
  return ok ? newName : `${newName}.${oldExt}`;
}

export async function renameTo(id: EntryId, name: string) {
  await editorActions.flushAll();
  return guard('Unable to rename.', () => ws().rename(id, name));
}

/** Closes a tab. Leaves the document first so the view doesn't reopen it while closing. */
export async function closeTab(id: EntryId) {
  await editorActions.flush(id);
  const route = useRouter.getState().route;
  const b = useEditor.getState().buffers[id];
  const dirty = !!b && b.status !== 'loading' && b.text !== b.savedText;
  if (!dirty && route.name === 'doc' && route.id === id) {
    const { tabs } = useEditor.getState();
    const rest = tabs.filter((t) => t !== id);
    const next = rest[Math.min(tabs.indexOf(id), rest.length - 1)];
    navigate(next ? { name: 'doc', id: next } : { name: 'home' }, { replace: true });
  }
  await editorActions.close(id);
}

export async function moveEntries(ids: EntryId[], targetId?: EntryId | null) {
  if (!ids.length) return;
  let target = targetId;
  if (target === undefined) {
    target = await dialogs.pickFolder({
      title: ids.length > 1 ? `Move ${ids.length} items` : `Move "${ws().get(ids[0]!)?.name}"`,
      confirmLabel: 'Move here',
      excludeIds: ids,
    });
    if (target === undefined) return;
  }
  const tree = ws().tree;
  if (ids.some((id) => !tree.canMove(id, target))) {
    toast({ message: "A folder can't be moved into itself.", tone: 'error' });
    return;
  }
  const previous = new Map(ids.map((id) => [id, ws().get(id)?.parentId ?? null]));
  await editorActions.flushAll();
  const moved = await guard('Unable to move.', () => ws().move(ids, target));
  if (!moved?.length) return;
  if (target) appActions.setExpanded(target, true);
  const dest = target ? ws().get(target)?.name : 'the workspace root';
  toast({
    message:
      moved.length === 1
        ? `Moved "${moved[0]!.name}" to ${dest}.`
        : `Moved ${moved.length} items to ${dest}.`,
    action: {
      label: 'Undo',
      run: () => {
        void (async () => {
          for (const m of moved) await ws().move([m.id], previous.get(m.id) ?? null);
        })();
      },
    },
  });
}

export async function duplicateEntry(id: EntryId) {
  await editorActions.flush(id);
  const copy = await guard('Unable to duplicate.', () => ws().duplicate(id));
  if (copy) toast({ message: `Created "${copy.name}".`, tone: 'success' });
  return copy;
}

export async function trashEntries(ids: EntryId[]) {
  if (!ids.length) return;
  for (const id of ids) await editorActions.flush(id);
  const trashed = await guard('Unable to move to Trash.', () => ws().trash(ids));
  if (!trashed?.length) return;
  const first = ws().get(trashed[0]!);
  const route = useRouter.getState().route;
  if (route.name === 'doc' && ws().tree.isTrashed(route.id)) {
    const next = useEditor.getState().activeId;
    if (next && !ws().tree.isTrashed(next)) navigate({ name: 'doc', id: next }, { replace: true });
    else navigate({ name: 'home' }, { replace: true });
  }
  if (route.name === 'folder' && route.id && ws().tree.isTrashed(route.id))
    navigate({ name: 'home' }, { replace: true });
  toast({
    message:
      trashed.length === 1
        ? `"${first?.name}" moved to Trash.`
        : `${trashed.length} items moved to Trash.`,
    action: { label: 'Undo', run: () => void restoreEntries(trashed, true) },
  });
}

export async function restoreEntries(ids: EntryId[], quiet = false) {
  const restored = await guard('Unable to restore.', () => ws().restore(ids));
  if (!restored?.length) return;
  for (const r of restored) appActions.reveal(r.id);
  if (!quiet) {
    toast({
      message:
        restored.length === 1
          ? `Restored "${restored[0]!.name}".`
          : `Restored ${restored.length} items.`,
      tone: 'success',
      action:
        restored[0]!.kind === 'file'
          ? { label: 'Open', run: () => void openEntry(restored[0]!.id) }
          : undefined,
    });
  }
}

export async function deletePermanently(ids: EntryId[]) {
  if (!ids.length) return;
  const name = ws().get(ids[0]!)?.name;
  const ok = await dialogs.confirm({
    title: 'Delete permanently?',
    message:
      ids.length === 1
        ? `"${name}" will be deleted forever, including its version history. This can't be undone.`
        : `${ids.length} items will be deleted forever, including their version history. This can't be undone.`,
    confirmLabel: 'Delete forever',
    danger: true,
  });
  if (!ok) return;
  await guard('Unable to delete.', () => ws().deletePermanently(ids));
}

export async function emptyTrash() {
  const count = ws().tree.trashedRoots().length;
  if (!count) return;
  const ok = await dialogs.confirm({
    title: 'Empty Trash?',
    message: `${count} item${count > 1 ? 's' : ''} will be deleted forever, including version history. This can't be undone.`,
    confirmLabel: 'Empty Trash',
    danger: true,
  });
  if (!ok) return;
  await guard('Unable to empty the Trash.', () => ws().emptyTrash());
}

export async function toggleFavorite(id: EntryId) {
  const e = ws().get(id);
  if (!e) return;
  await guard('Unable to update favorites.', () => ws().setFavorite(id, !e.favorite));
}

export async function runImport(items: ImportItem[], targetId: EntryId | null = contextFolderId()) {
  if (!items.length) return;
  const progressToast = toast({
    message: `Importing ${items.length} item${items.length > 1 ? 's' : ''}…`,
    duration: 60_000,
  });
  try {
    const result = await importItems(ws(), targetId, items, (name, remaining) =>
      dialogs.conflict({ name, count: remaining }),
    );
    dismissToast(progressToast);
    for (const { id, handle } of result.diskLinks) await diskLinks.link(id, handle);
    // Ask for write access while the picker's click still counts as a user gesture.
    void diskLinks.requestAll(result.diskLinks.map((l) => l.id));
    if (targetId) appActions.setExpanded(targetId, true);
    const parts = [`${result.files} file${result.files === 1 ? '' : 's'}`];
    if (result.folders) parts.push(`${result.folders} folder${result.folders === 1 ? '' : 's'}`);
    if (result.replaced) parts.push(`${result.replaced} replaced`);
    const skipped = result.skipped.filter(
      (s) => s.reason !== 'Already exists.' && s.reason !== 'Import cancelled.',
    );
    toast({
      message: `Imported ${parts.join(', ')}.`,
      detail: skipped.length
        ? `${skipped.length} skipped: ${skipped
            .slice(0, 3)
            .map((s) => `${s.path} (${s.reason})`)
            .join('; ')}${skipped.length > 3 ? '…' : ''}`
        : undefined,
      tone: skipped.length ? 'info' : 'success',
      action: result.firstFileId
        ? { label: 'Open', run: () => void openEntry(result.firstFileId!) }
        : undefined,
    });
  } catch (err) {
    dismissToast(progressToast);
    toastError('The import stopped before finishing. Files imported so far were kept.', err);
  }
}

function dismissToast(id: number) {
  useToasts.getState().dismiss(id);
}

export async function exportEntry(
  id: EntryId | null,
  format: 'file' | 'html' | 'zip' | 'pdf' | 'txt',
) {
  await editorActions.flushAll();
  await guard('Unable to export.', async () => {
    if (format === 'zip') return exportZip(ws(), id);
    if (!id) return;
    if (format === 'file') return exportFile(ws(), id);
    if (format === 'html') return exportHtml(ws(), id);
    if (format === 'txt') return exportText(ws(), id);
    if (format === 'pdf') {
      if (!canPrint) {
        // Mobile web views have no print dialog; share a print-ready HTML file instead.
        toast({
          message: "PDF export isn't available in the mobile app. Sharing as HTML instead.",
        });
        return exportHtml(ws(), id);
      }
      await openEntry(id);
      useUi.getState().setReadingMode(true);
      setTimeout(() => window.print(), 400);
    }
  });
}

/** Links a plain-text mention of `targetId` in `sourceId` (from "Unlinked mentions"). */
export async function linkMention(sourceId: EntryId, targetId: EntryId) {
  const target = ws().get(targetId);
  if (!target) return;
  await editorActions.flush(sourceId);
  await guard('Unable to add the link.', () => ws().linkMention(sourceId, baseName(target.name)));
}

export async function addTagTo(id: EntryId) {
  const tag = await dialogs.prompt({
    title: 'Add tag',
    label: 'Tag',
    confirmLabel: 'Add',
    validate: (v) =>
      isValidTag(normalizeTag(v)) ? null : 'Tags can use letters, numbers, -, _ and /.',
  });
  if (!tag) return;
  await editorActions.flush(id);
  await guard('Unable to add the tag.', () => ws().addTag(id, tag));
}

export async function removeTagFrom(id: EntryId, tag: string) {
  await editorActions.flush(id);
  await guard('Unable to remove the tag.', () => ws().removeTag(id, tag));
}

export async function renameTagEverywhere(tag: string) {
  const next = await dialogs.prompt({
    title: `Rename #${tag}`,
    label: 'New tag name',
    initial: tag,
    confirmLabel: 'Rename',
    validate: (v) =>
      isValidTag(normalizeTag(v)) ? null : 'Tags can use letters, numbers, -, _ and /.',
  });
  if (!next || normalizeTag(next) === tag) return;
  await editorActions.flushAll();
  const ids = session().knowledge.docsWithTag(ws().tree, tag);
  const changed = await guard('Unable to rename the tag.', () =>
    ws().renameTag(ids, tag, normalizeTag(next)),
  );
  if (changed) {
    toast({
      message: `Renamed #${tag} to #${normalizeTag(next)} in ${changed.length} document${changed.length === 1 ? '' : 's'}.`,
      tone: 'success',
    });
    navigate({ name: 'tags', tag: normalizeTag(next) }, { replace: true });
  }
}

export async function restoreVersion(id: EntryId, versionId: string) {
  await editorActions.flush(id);
  const restored = await guard('Unable to restore this version.', () =>
    ws().restoreVersion(id, versionId),
  );
  if (restored)
    toast({
      message: 'Version restored. The previous text was saved to history.',
      tone: 'success',
    });
}

export function selectedOrActive(): Entry | undefined {
  const id = useEditor.getState().activeId;
  return id ? ws().get(id) : undefined;
}

export async function newWorkspace() {
  const name = await dialogs.prompt({
    title: 'New workspace',
    label: 'Workspace name',
    initial: 'New workspace',
    confirmLabel: 'Create',
    validate: nameValidator,
  });
  if (!name) return;
  await editorActions.flushAll();
  await guard('Unable to create the workspace.', async () => {
    await appActions.createWorkspace(name.trim());
    await editorActions.restoreSession();
    navigate({ name: 'home' });
  });
}

export async function switchWorkspace(id: string) {
  await editorActions.flushAll();
  await guard('Unable to open the workspace.', async () => {
    await appActions.switchWorkspace(id);
    await editorActions.restoreSession();
    navigate({ name: 'home' });
  });
}

export async function renameWorkspace() {
  const s = useApp.getState().session;
  if (!s) return;
  const name = await dialogs.prompt({
    title: 'Rename workspace',
    label: 'Workspace name',
    initial: s.workspace.name,
    confirmLabel: 'Rename',
    validate: nameValidator,
  });
  if (!name) return;
  await guard('Unable to rename the workspace.', () =>
    appActions.renameWorkspace(s.workspace.id, name.trim()),
  );
}

export async function deleteWorkspace() {
  const s = useApp.getState().session;
  if (!s) return;
  const ok = await dialogs.confirm({
    title: `Delete "${s.workspace.name}"?`,
    message:
      "Every document, folder and version in this workspace will be deleted from this browser. Export it first if you want a copy. This can't be undone.",
    confirmLabel: 'Delete workspace',
    danger: true,
  });
  if (!ok) return;
  await editorActions.flushAll();
  await guard('Unable to delete the workspace.', async () => {
    await appActions.deleteWorkspace(s.workspace.id);
    await editorActions.restoreSession();
    navigate({ name: 'home' });
  });
}
