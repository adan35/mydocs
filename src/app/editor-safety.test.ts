import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { unzipSync, strFromU8 } from 'fflate';
import { MemoryProvider, type MemoryWorkspaceStore } from '@/storage/memory';
import { Workspace, setWriteGuard } from './workspace';
import { WorkspaceSession } from './session';
import { useApp } from './app-store';
import { editorActions, useEditor, writeRecoveryDrafts } from './editor-store';
import { dialogs } from './dialog-store';
import { prefs } from './prefs';
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
