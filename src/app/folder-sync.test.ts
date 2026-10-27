import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryProvider } from '@/storage/memory';
import { Workspace, setWriteGuard } from './workspace';
import { WorkspaceSession } from './session';
import { useApp } from './app-store';
import { folderSync, useFolderLinks } from './folder-sync';
import { useToasts } from './toast-store';
import * as actions from './actions';

vi.mock('@/platform', () => ({ saveFile: vi.fn(), canPrint: true }));

type Tree = { [name: string]: string | Tree };

/** A fake disk folder: a nested map of names to text (files) or maps (folders). */
function dir(name: string, tree: Tree): FileSystemDirectoryHandle {
  return {
    kind: 'directory',
    name,
    async *values() {
      for (const [n, v] of Object.entries(tree))
        yield typeof v === 'string'
          ? ({
              kind: 'file',
              name: n,
              getFile: async () => new File([v], n, { lastModified: 1 }),
            } as unknown as FileSystemFileHandle)
          : dir(n, v);
    },
    queryPermission: async () => 'granted',
  } as unknown as FileSystemDirectoryHandle;
}

let workspace: Workspace;
let projId: string;

beforeEach(async () => {
  setWriteGuard(() => true);
  const provider = new MemoryProvider();
  const info = await provider.create('Test');
  workspace = await Workspace.open(await provider.open(info.id));
  useApp.setState({ provider, session: new WorkspaceSession(workspace) });
  useToasts.setState({ toasts: [] });
  const proj = await workspace.createFolder(null, 'proj');
  projId = proj.id;
  await workspace.createFile(projId, 'a.md', 'old');
});

const names = () =>
  workspace.tree
    .childrenOf(projId)
    .flatMap((e) => (e.kind === 'folder' ? workspace.tree.childrenOf(e.id) : [e]))
    .map((e) => e.name)
    .sort();

describe('folder sync', () => {
  it('adds files created on disk, including in new subfolders, and tells the person', async () => {
    const disk: Tree = { 'a.md': 'old' };
    await folderSync.link(projId, dir('proj', disk), ['a.md']);
    disk['b.md'] = 'new';
    disk.sub = { 'c.md': 'deep' };
    await folderSync.syncNow(projId);
    expect(names()).toEqual(['a.md', 'b.md', 'c.md']);
    expect(workspace.tree.findByPath('proj/sub/c.md')).toBeTruthy();
    expect(useToasts.getState().toasts.at(-1)?.message).toBe('"proj": 2 new files added.');
    expect(useFolderLinks.getState().links[projId]?.state).toBe('idle');
  });

  it('never re-adds a file deleted in My Doc and never deletes anything', async () => {
    const disk: Tree = { 'a.md': 'old', 'b.md': 'new' };
    await folderSync.link(projId, dir('proj', disk), ['a.md']);
    await folderSync.syncNow(projId);
    const b = workspace.tree.findByPath('proj/b.md')!;
    await workspace.trash([b.id]);
    delete disk['a.md'];
    await folderSync.syncNow(projId);
    expect(workspace.tree.findByPath('proj/b.md')).toBeUndefined();
    expect(workspace.tree.findByPath('proj/a.md')).toBeTruthy();
    expect(useToasts.getState().toasts.at(-1)?.message).toBe('"proj" is up to date.');
  });

  it('keeps the folder handle of a folder import and syncs it later', async () => {
    const disk: Tree = { 'x.md': 'one' };
    const root = dir('imported', disk);
    await actions.runImport(
      [{ path: 'imported/x.md', file: new File(['one'], 'x.md'), root }],
      null,
    );
    const folder = workspace.tree.findByPath('imported')!;
    expect(useFolderLinks.getState().links[folder.id]?.watch).toBe(true);
    disk['y.md'] = 'two';
    await folderSync.syncNow(folder.id);
    expect(workspace.tree.findByPath('imported/y.md')).toBeTruthy();
  });

  it('imports files already missing from a folder linked later', async () => {
    await folderSync.link(projId, dir('proj', { 'a.md': 'old', 'z.md': 'missing' }));
    await folderSync.syncNow(projId);
    expect(names()).toEqual(['a.md', 'z.md']);
  });
});
