import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { unzipSync, strFromU8 } from 'fflate';
import { MemoryProvider, type MemoryWorkspaceStore } from '@/storage/memory';
import { Workspace, setWriteGuard } from './workspace';
import { WorkspaceSession } from './session';
import { useApp } from './app-store';
import { editorActions, useEditor, writeRecoveryDrafts } from './editor-store';
import { dialogs } from './dialog-store';
import { prefs } from './prefs';
import { externalSaves } from './external-saves';
import { workbookToXlsx, xlsxToWorkbook } from '@/lib/convert/xlsx';
import { diskLinks, useDiskLinks } from './disk-links';
import * as actions from './actions';

const saveFile = vi.hoisted(() => vi.fn().mockResolvedValue(true));
vi.mock('@/platform', () => ({ saveFile, canPrint: true }));

let workspace: Workspace;
let store: MemoryWorkspaceStore;
let session: WorkspaceSession;
let unsubscribe: () => void;

beforeEach(async () => {
  vi.useFakeTimers();
  vi.spyOn(console, 'error').mockImplementation(() => {});
  localStorage.clear();
  editorActions.reset();
  setWriteGuard(() => true);
  const provider = new MemoryProvider();
  const info = await provider.create('Test');
  store = await provider.open(info.id);
  workspace = await Workspace.open(store);
  session = new WorkspaceSession(workspace);
  useApp.setState({ provider, session, workspaces: await provider.list() });
  unsubscribe = workspace.subscribe((event) => {
    if (event.type === 'tree') editorActions.onTreeChange();
    if (event.type === 'content' && event.source === 'external')
      editorActions.onExternalContent(event.ids);
  });
  saveFile.mockClear();
});

afterEach(() => {
  editorActions.reset();
  unsubscribe();
  session.dispose();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

async function dirty(parent: string | null = null) {
  const entry = await workspace.createFile(parent, 'Notes.md', 'Original');
  await editorActions.open(entry.id);
  editorActions.replaceText(entry.id, 'Latest changes');
  return entry;
}

const workbookBlob = (value: string) =>
  new Blob(
    [workbookToXlsx({ sheets: [{ name: 'Sheet1', rows: [[{ v: value }]] }] }).data as BlobPart],
    { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' },
  );

async function dirtyWorkbook(parent: string | null = null) {
  const entry = await workspace.createFile(parent, 'Book.xlsx', workbookBlob('Original'));
  const draft = workbookBlob('Latest edit');
  let unsaved = true;
  externalSaves.register(entry.id, {
    flush: async () => {
      if (!unsaved) return;
      await workspace.saveBlob(entry.id, draft);
      unsaved = false;
    },
    hasUnsaved: () => unsaved,
    exportBlob: async () => draft,
  });
  await editorActions.open(entry.id);
  return entry;
}

async function workbookValue(blob: Blob) {
  return xlsxToWorkbook(new Uint8Array(await blob.arrayBuffer())).workbook.sheets[0]?.rows[0]?.[0]
    ?.v;
}

async function changedWorkbookOnDisk() {
  // IndexedDB's file-handle persistence uses real asynchronous request callbacks.
  vi.useRealTimers();
  await diskLinks.load(workspace.id, () => true);
  const entry = await dirtyWorkbook();
  let file = new File([workbookBlob('Original')], 'Book.xlsx', { lastModified: 1000 });
  const handle = {
    kind: 'file',
    name: file.name,
    getFile: async () => file,
    queryPermission: async () => 'granted',
  } as unknown as FileSystemFileHandle;
  await diskLinks.link(entry.id, handle, { binary: true });
  file = new File([workbookBlob('External edit')], 'Book.xlsx', { lastModified: 2000 });
  return entry;
}

describe('save failures preserve work', () => {
  it('keeps the current workspace and edits when switching cannot save', async () => {
    const entry = await dirty();
    const other = await useApp.getState().provider.create('Other');
    useApp.setState({ workspaces: await useApp.getState().provider.list() });
    store.failNextCommit = true;
    await actions.switchWorkspace(other.id);
    expect(useApp.getState().session).toBe(session);
    expect(editorActions.textOf(entry.id)).toBe('Latest changes');
    expect(useEditor.getState().buffers[entry.id]?.status).toBe('error');
  });

  it('does not create a workspace when the current edits cannot save', async () => {
    await dirty();
    vi.spyOn(dialogs, 'prompt').mockResolvedValue('New workspace');
    store.failNextCommit = true;
    await actions.newWorkspace();
    expect(await useApp.getState().provider.list()).toHaveLength(1);
    expect(useApp.getState().session).toBe(session);
  });

  it('saves descendant edits before trashing a folder, and restores their latest text', async () => {
    const folder = await workspace.createFolder(null, 'Folder');
    const entry = await dirty(folder.id);
    await actions.trashEntries([folder.id]);
    expect(workspace.tree.isTrashed(entry.id)).toBe(true);
    expect(useEditor.getState().buffers[entry.id]).toBeUndefined();
    await workspace.restore([folder.id]);
    expect(await workspace.readText(entry.id)).toBe('Latest changes');
  });

  it('keeps a folder and its dirty descendants open when saving fails', async () => {
    const folder = await workspace.createFolder(null, 'Folder');
    const entry = await dirty(folder.id);
    store.failNextCommit = true;
    await actions.trashEntries([folder.id]);
    expect(workspace.tree.isTrashed(folder.id)).toBe(false);
    expect(editorActions.textOf(entry.id)).toBe('Latest changes');
  });

  it('duplicates the latest text of documents inside a folder', async () => {
    const folder = await workspace.createFolder(null, 'Folder');
    await dirty(folder.id);
    const copy = await actions.duplicateEntry(folder.id);
    const copied = workspace.tree.childrenOf(copy!.id)[0]!;
    expect(await workspace.readText(copied.id)).toBe('Latest changes');
  });

  it.each(['file', 'folder'])('duplicates the latest workbook bytes for a %s', async (kind) => {
    const folder = kind === 'folder' ? await workspace.createFolder(null, 'Folder') : null;
    const entry = await dirtyWorkbook(folder?.id);
    const copy = await actions.duplicateEntry(folder?.id ?? entry.id);
    const copied = folder ? workspace.tree.childrenOf(copy!.id)[0]! : copy!;
    expect(await workbookValue((await workspace.readBlob(copied.id))!)).toBe('Latest edit');
  });

  it.each(['file', 'folder'])('blocks trashing a %s when workbook saving fails', async (kind) => {
    const folder = kind === 'folder' ? await workspace.createFolder(null, 'Folder') : null;
    const entry = await dirtyWorkbook(folder?.id);
    store.failNextCommit = true;
    await actions.trashEntries([folder?.id ?? entry.id]);
    expect(workspace.tree.isTrashed(entry.id)).toBe(false);
    if (folder) expect(workspace.tree.isTrashed(folder.id)).toBe(false);
    expect(editorActions.hasUnsaved()).toBe(true);
    expect(useEditor.getState().tabs).toContain(entry.id);
  });

  it('exports unsaved workbook bytes when local saving fails', async () => {
    const entry = await dirtyWorkbook();
    store.failNextCommit = true;
    await actions.exportEntry(entry.id, 'file');
    expect(await workbookValue(saveFile.mock.calls[0]![0] as Blob)).toBe('Latest edit');
    expect(await workbookValue((await workspace.readBlob(entry.id))!)).toBe('Original');
  });

  it('includes unsaved workbook bytes in folder ZIP exports after a save failure', async () => {
    const folder = await workspace.createFolder(null, 'Folder');
    await dirtyWorkbook(folder.id);
    store.failNextCommit = true;
    await actions.exportEntry(folder.id, 'zip');
    const files = unzipSync(
      new Uint8Array(await (saveFile.mock.calls[0]![0] as Blob).arrayBuffer()),
    );
    expect(await workbookValue(new Blob([files['Book.xlsx']! as BlobPart]))).toBe('Latest edit');
  });

  it('exports a document even when an unrelated workbook draft cannot be serialized', async () => {
    const entry = await dirty();
    externalSaves.register('unrelated-workbook', {
      flush: async () => {},
      hasUnsaved: () => true,
      exportBlob: async () => {
        throw new Error('Unable to serialize workbook');
      },
    });
    await actions.exportEntry(entry.id, 'file');
    expect(await (saveFile.mock.calls[0]![0] as Blob).text()).toBe('Latest changes');
  });

  it('detects a disk conflict before pending workbook edits have reached storage', async () => {
    const entry = await changedWorkbookOnDisk();
    expect(await diskLinks.check(entry.id)).toBe(false);
    expect(useDiskLinks.getState().links[entry.id]?.state).toBe('conflict');
    expect(await workbookValue((await workspace.readBlob(entry.id))!)).toBe('Original');
    expect(await workbookValue((await externalSaves.draftBlobs([entry.id])).get(entry.id)!)).toBe(
      'Latest edit',
    );
  });

  it('keeps a disk conflict unresolved if workbook edits cannot first be saved', async () => {
    const entry = await changedWorkbookOnDisk();
    await diskLinks.check(entry.id);
    store.failNextCommit = true;
    await diskLinks.resolve(entry.id, 'disk');
    expect(useDiskLinks.getState().links[entry.id]?.state).toBe('conflict');
    expect(externalSaves.hasUnsaved([entry.id])).toBe(true);
    expect(await workbookValue((await workspace.readBlob(entry.id))!)).toBe('Original');
  });

  it('finishes pending workbook edits before taking the disk version', async () => {
    const entry = await changedWorkbookOnDisk();
    await diskLinks.check(entry.id);
    await diskLinks.resolve(entry.id, 'disk');
    expect(useDiskLinks.getState().links[entry.id]?.state).toBe('synced');
    expect(externalSaves.hasUnsaved([entry.id])).toBe(false);
    expect(await workbookValue((await workspace.readBlob(entry.id))!)).toBe('External edit');
    const versions = await store.listVersions(entry.id);
    const latest = await Promise.all(
      versions.flatMap((v) => (v.blob ? [workbookValue(v.blob)] : [])),
    );
    expect(latest).toContain('Latest edit');
  });

  it('pauses a rename instead of rewriting links over unsaved edits', async () => {
    const entry = await dirty();
    store.failNextCommit = true;
    await actions.renameTo(entry.id, 'Renamed.md');
    expect(workspace.get(entry.id)?.name).toBe('Notes.md');
    expect(editorActions.textOf(entry.id)).toBe('Latest changes');
  });

  it('versions the latest editor text before replacing a document during import', async () => {
    const entry = await dirty();
    vi.spyOn(dialogs, 'conflict').mockResolvedValue({ action: 'replace', applyToAll: false });
    await actions.runImport(
      [{ path: 'Notes.md', file: new File(['Imported text'], 'Notes.md') }],
      null,
    );
    expect(await workspace.readText(entry.id)).toBe('Imported text');
    expect(editorActions.textOf(entry.id)).toBe('Imported text');
    expect(await store.listVersions(entry.id)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ text: 'Latest changes', reason: 'import' }),
      ]),
    );
  });

  it('pauses import replacement if the latest edits cannot be saved', async () => {
    const entry = await dirty();
    const conflict = vi.spyOn(dialogs, 'conflict');
    store.failNextCommit = true;
    await actions.runImport(
      [{ path: 'Notes.md', file: new File(['Imported text'], 'Notes.md') }],
      null,
    );
    expect(conflict).not.toHaveBeenCalled();
    expect(await workspace.readText(entry.id)).toBe('Original');
    expect(editorActions.textOf(entry.id)).toBe('Latest changes');
  });

  it('exports the latest edits as a workspace zip even when local saving fails', async () => {
    await dirty();
    store.failNextCommit = true;
    await actions.exportEntry(null, 'zip');
    const blob = saveFile.mock.calls[0]![0] as Blob;
    const files = unzipSync(new Uint8Array(await blob.arrayBuffer()));
    expect(strFromU8(files['Notes.md']!)).toBe('Latest changes');
    expect(editorActions.hasUnsaved()).toBe(true);
  });

  it('exports an unsaved empty document without falling back to its old content', async () => {
    const entry = await dirty();
    editorActions.replaceText(entry.id, '');
    store.failNextCommit = true;
    await actions.exportEntry(entry.id, 'file');
    const blob = saveFile.mock.calls[0]![0] as Blob;
    expect(await blob.text()).toBe('');
  });

  it('keeps failed recovery text visible and exportable, including after other saves', async () => {
    const entry = await workspace.createFile(null, 'Recovered.md', 'Old content');
    const key = `mydoc:recovery:${workspace.id}`;
    prefs.set(key, { [entry.id]: { text: 'Recovered changes', at: Date.now() } });
    store.failNextCommit = true;
    await editorActions.restoreSession();
    expect(editorActions.textOf(entry.id)).toBe('Recovered changes');
    expect(useEditor.getState().tabs).toContain(entry.id);
    writeRecoveryDrafts();
    expect(prefs.get<Record<string, { text: string }>>(key, {})[entry.id]?.text).toBe(
      'Recovered changes',
    );
    await editorActions.flush(entry.id);
    expect(await workspace.readText(entry.id)).toBe('Recovered changes');
    expect(prefs.get(key, null)).toBeNull();
  });

  it('does not erase recovery copies for documents that have not been opened', async () => {
    const entry = await workspace.createFile(null, 'Closed.md', 'Old');
    const key = `mydoc:recovery:${workspace.id}`;
    prefs.set(key, { [entry.id]: { text: 'Still recoverable', at: Date.now() } });
    writeRecoveryDrafts();
    expect(prefs.get<Record<string, { text: string }>>(key, {})[entry.id]?.text).toBe(
      'Still recoverable',
    );
  });

  it('blocks edits after a failed read and supports retry without overwriting the file', async () => {
    const entry = await workspace.createFile(null, 'Read.md', 'Safe original');
    vi.spyOn(workspace, 'readText').mockRejectedValueOnce(new Error('Read failed'));
    await editorActions.open(entry.id);
    expect(useEditor.getState().buffers[entry.id]?.status).toBe('load-error');
    expect(editorActions.replaceText(entry.id, 'Overwrite')).toBe(false);
    await editorActions.flush(entry.id);
    expect(await workspace.readText(entry.id)).toBe('Safe original');
    await editorActions.retryLoad(entry.id);
    expect(editorActions.textOf(entry.id)).toBe('Safe original');
  });

  it('preserves recovery copies across read failures and applies them when retry succeeds', async () => {
    const entry = await workspace.createFile(null, 'Read.md', 'Safe original');
    const key = `mydoc:recovery:${workspace.id}`;
    prefs.set(key, { [entry.id]: { text: 'Recovery text', at: Date.now() } });
    vi.spyOn(workspace, 'readText').mockRejectedValueOnce(new Error('Read failed'));
    await editorActions.restoreSession();
    writeRecoveryDrafts();
    expect(useEditor.getState().buffers[entry.id]?.status).toBe('load-error');
    expect(prefs.get<Record<string, { text: string }>>(key, {})[entry.id]?.text).toBe(
      'Recovery text',
    );
    await editorActions.retryLoad(entry.id);
    expect(editorActions.textOf(entry.id)).toBe('Recovery text');
    expect(await workspace.readText(entry.id)).toBe('Recovery text');
  });
});
