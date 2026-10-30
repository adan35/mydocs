import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryProvider } from '@/storage/memory';
import { Workspace, setWriteGuard } from './workspace';
import { WorkspaceSession } from './session';
import { useApp } from './app-store';
import { dialogs } from './dialog-store';
import { diskLinks, useDiskLinks } from './disk-links';
import { diskRemoved } from './disk-removed';
import { folderSync, useFolderLinks } from './folder-sync';
import { useSettings } from './settings-store';
import { useToasts } from './toast-store';

vi.mock('@/platform', () => ({ saveFile: vi.fn(), canPrint: true }));

type Tree = { [name: string]: string | Tree };
const notFound = () => new DOMException('gone', 'NotFoundError');

/** A fake disk folder that is looked up on every call, so deleting from `disk` is seen at once. */
function dirAt(disk: Tree, path: string[]): FileSystemDirectoryHandle {
  const node = (): Tree => {
    let cur: Tree = disk;
    for (const p of path) {
      const next = cur[p];
      if (typeof next !== 'object') throw notFound();
      cur = next;
    }
    return cur;
  };
  return {
    kind: 'directory',
    name: path.at(-1) ?? 'root',
    async *values() {
      for (const [n, v] of Object.entries(node()))
        yield typeof v === 'string' ? fileAt(disk, [...path, n]) : dirAt(disk, [...path, n]);
    },
    queryPermission: async () => 'granted',
  } as unknown as FileSystemDirectoryHandle;
}

const clock = 1;
function fileAt(disk: Tree, path: string[]): FileSystemFileHandle {
  const read = () => {
    let cur: Tree | string = disk;
    for (const p of path) {
      if (typeof cur !== 'object' || !(p in cur)) throw notFound();
      cur = cur[p]!;
    }
    return cur as string;
  };
  return {
    kind: 'file',
    name: path.at(-1),
    // Each text has its own modified time, as a real edit would.
    getFile: async () => {
      const text = read();
      return new File([text], path.at(-1)!, { lastModified: 1000 + text.length * 7 + clock });
    },
    createWritable: async () => {
      read();
      return { write: async () => {}, close: async () => {} };
    },
    queryPermission: async () => 'granted',
  } as unknown as FileSystemFileHandle;
}

let workspace: Workspace;
let confirm: ReturnType<typeof vi.spyOn>;

beforeEach(async () => {
  setWriteGuard(() => true);
  Object.assign(window, { showOpenFilePicker: () => {}, showDirectoryPicker: () => {} });
  const provider = new MemoryProvider();
  const info = await provider.create('Test');
  workspace = await Workspace.open(await provider.open(info.id));
  useApp.setState({ provider, session: new WorkspaceSession(workspace) });
  useToasts.setState({ toasts: [] });
  useSettings.getState().reset();
  for (const id of diskLinks.linkedIds()) await diskLinks.unlink(id);
  for (const id of Object.keys(useFolderLinks.getState().links)) await folderSync.unlink(id);
  confirm = vi.spyOn(dialogs, 'confirm').mockResolvedValue(true);
});

afterEach(() => vi.restoreAllMocks());

const state = (id: string) => useDiskLinks.getState().links[id]?.state;
const live = (path: string) => workspace.tree.findByPath(path);

async function linkedFile(disk: Tree, name: string) {
  const entry = await workspace.createFile(null, name, disk[name] as string);
  await diskLinks.link(entry.id, fileAt(disk, [name]));
  return entry.id;
}

describe('a file deleted on disk', () => {
  it('shows as deleted from disk instead of failing to save', async () => {
    const disk: Tree = { 'a.md': 'one' };
    const id = await linkedFile(disk, 'a.md');
    delete disk['a.md'];
    await diskLinks.check(id);
    expect(state(id)).toBe('missing');
    // Edits don't turn it into a save error, and the text is still in My Doc.
    await diskLinks.write(id, 'edited');
    expect(state(id)).toBe('missing');
    expect(live('a.md')).toBeTruthy();
  });

  it('Delete moves it to Trash and unlinks it', async () => {
    const disk: Tree = { 'a.md': 'one' };
    const id = await linkedFile(disk, 'a.md');
    delete disk['a.md'];
    await diskLinks.check(id);
    await diskRemoved.ask([id]);
    expect(confirm.mock.calls[0]![0]).toMatchObject({
      confirmLabel: 'Delete',
      cancelLabel: 'Keep',
    });
    expect(workspace.tree.isTrashed(id)).toBe(true);
    expect(diskLinks.isLinked(id)).toBe(false);
  });

  it('Keep leaves the document and stops tracking the file', async () => {
    confirm.mockResolvedValue(false);
    const disk: Tree = { 'a.md': 'one' };
    const id = await linkedFile(disk, 'a.md');
    delete disk['a.md'];
    await diskLinks.check(id);
    await diskRemoved.ask([id]);
    expect(workspace.tree.isTrashed(id)).toBe(false);
    expect(diskLinks.isLinked(id)).toBe(false);
    expect(state(id)).toBeUndefined();
  });

  it('asks by itself once it is noticed, one question for several files', async () => {
    confirm.mockResolvedValue(false);
    const disk: Tree = { 'a.md': '1', 'b.md': '2' };
    const a = await linkedFile(disk, 'a.md');
    const b = await linkedFile(disk, 'b.md');
    const stop = diskRemoved.watch();
    delete disk['a.md'];
    delete disk['b.md'];
    await Promise.all([diskLinks.check(a), diskLinks.check(b)]);
    await vi.waitFor(() => expect(confirm).toHaveBeenCalledTimes(1), { timeout: 3000 });
    stop();
    expect(confirm.mock.calls[0]![0].message).toContain('2 files');
  });

  it('is not mistaken for a deletion while an editor swaps the file', async () => {
    const disk: Tree = { 'a.md': 'one' };
    const id = await linkedFile(disk, 'a.md');
    const file = disk['a.md'];
    delete disk['a.md'];
    setTimeout(() => (disk['a.md'] = file as string), 100);
    await diskLinks.check(id);
    expect(state(id)).toBe('synced');
  });

  it('comes back when the file reappears', async () => {
    const disk: Tree = { 'a.md': 'one' };
    const id = await linkedFile(disk, 'a.md');
    delete disk['a.md'];
    await diskLinks.check(id);
    disk['a.md'] = 'one';
    await diskLinks.check(id);
    expect(state(id)).toBe('synced');
  });
});

describe('a folder deleted on disk', () => {
  async function linkedFolder(disk: Tree) {
    const folder = await workspace.createFolder(null, 'proj');
    await workspace.createFile(folder.id, 'a.md', 'one');
    await folderSync.link(folder.id, dirAt(disk, ['proj']));
    await folderSync.syncNow(folder.id);
    return folder.id;
  }

  it('asks once about the whole tree, and Delete trashes it all', async () => {
    const disk: Tree = { proj: { 'a.md': 'one' } };
    const id = await linkedFolder(disk);
    const file = live('proj/a.md')!;
    delete disk.proj;
    await folderSync.syncNow(id);
    expect(useFolderLinks.getState().links[id]?.state).toBe('missing');
    await diskRemoved.ask([file.id]);
    expect(confirm).toHaveBeenCalledTimes(1);
    expect(confirm.mock.calls[0]![0].title).toBe('Folder deleted from disk');
    expect(workspace.tree.isTrashed(id)).toBe(true);
    expect(folderSync.isLinked(id)).toBe(false);
    expect(diskLinks.isLinked(file.id)).toBe(false);
  });

  it('Keep unlinks the folder and its files and keeps everything', async () => {
    confirm.mockResolvedValue(false);
    const disk: Tree = { proj: { 'a.md': 'one' } };
    const id = await linkedFolder(disk);
    const file = live('proj/a.md')!;
    delete disk.proj;
    await folderSync.syncNow(id);
    await diskRemoved.ask([file.id]);
    expect(workspace.tree.isTrashed(id)).toBe(false);
    expect(live('proj/a.md')).toBeTruthy();
    expect(folderSync.isLinked(id)).toBe(false);
    expect(diskLinks.isLinked(file.id)).toBe(false);
  });
});

describe('real-time folder sync', () => {
  async function liveFolder(disk: Tree) {
    const folder = await workspace.createFolder(null, 'proj');
    await folderSync.link(folder.id, dirAt(disk, ['proj']));
    await folderSync.setLive(folder.id, true);
    return folder.id;
  }

  it('follows the global default until a folder chooses', async () => {
    const id = (await workspace.createFolder(null, 'proj')).id;
    await folderSync.link(id, dirAt({ proj: {} }, ['proj']));
    expect(folderSync.isLive(id)).toBe(false);
    useSettings.getState().update({ liveFolderSync: true });
    expect(folderSync.isLive(id)).toBe(true);
    await folderSync.setLive(id, false);
    expect(folderSync.isLive(id)).toBe(false);
  });

  it('picks up new files and edits, and removes deleted files and emptied folders', async () => {
    useSettings.getState().update({ diskDeleteAction: 'remove' });
    const disk: Tree = { proj: { 'a.md': 'one', sub: { 'b.md': 'deep' } } };
    const id = await liveFolder(disk);
    expect(live('proj/a.md')).toBeTruthy();
    expect(live('proj/sub/b.md')).toBeTruthy();
    const stop = diskRemoved.watch();

    const proj = disk.proj as Tree;
    proj['c.md'] = 'new';
    proj['a.md'] = 'one, edited';
    delete proj.sub;
    await folderSync.syncNow(id);

    expect(live('proj/c.md')).toBeTruthy();
    expect(await workspace.readText(live('proj/a.md')!.id)).toBe('one, edited');
    await vi.waitFor(() => expect(workspace.tree.findByPath('proj/sub/b.md')).toBeUndefined(), {
      timeout: 3000,
    });
    stop();
    expect(workspace.tree.findByPath('proj/sub')).toBeUndefined();
    expect(confirm).not.toHaveBeenCalled();
    // Removed files can be brought back.
    expect(workspace.tree.trashedRoots().map((e) => e.name)).toContain('b.md');
  });

  it('asks before removing when set to ask', async () => {
    const disk: Tree = { proj: { 'a.md': 'one' } };
    const id = await liveFolder(disk);
    const stop = diskRemoved.watch();
    delete (disk.proj as Tree)['a.md'];
    await folderSync.syncNow(id);
    await vi.waitFor(() => expect(confirm).toHaveBeenCalledTimes(1), { timeout: 3000 });
    stop();
  });

  it('never removes files without asking when the whole folder is gone', async () => {
    useSettings.getState().update({ diskDeleteAction: 'remove' });
    const disk: Tree = { proj: { 'a.md': 'one' } };
    const id = await liveFolder(disk);
    const file = live('proj/a.md')!;
    delete disk.proj;
    await diskLinks.check(file.id);
    await diskRemoved.ask([file.id]);
    expect(confirm.mock.calls[0]![0].title).toBe('Folder deleted from disk');
    expect(useFolderLinks.getState().links[id]).toBeUndefined();
  });

  it('rescans soon after the browser reports a change', async () => {
    let notify = () => {};
    class FakeObserver {
      constructor(cb: () => void) {
        notify = cb;
      }
      observe = async () => {};
      disconnect() {}
    }
    Object.assign(globalThis, { FileSystemObserver: FakeObserver });
    try {
      const disk: Tree = { proj: { 'a.md': 'one' } };
      const id = await liveFolder(disk);
      await folderSync.syncNow(id);
      (disk.proj as Tree)['n.md'] = 'later';
      notify();
      await vi.waitFor(() => expect(live('proj/n.md')).toBeTruthy(), { timeout: 3000 });
    } finally {
      delete (globalThis as { FileSystemObserver?: unknown }).FileSystemObserver;
    }
  });
});

describe('both sides changed', () => {
  it('keeps the My Doc text in the history when the disk version is loaded', async () => {
    const disk: Tree = { 'a.md': 'original' };
    const id = await linkedFile(disk, 'a.md');
    await workspace.saveText(id, 'my edit');
    disk['a.md'] = 'edited elsewhere';
    await diskLinks.check(id);
    expect(state(id)).toBe('conflict');
    await diskLinks.resolve(id, 'disk');
    expect(await workspace.readText(id)).toBe('edited elsewhere');
    expect((await workspace.listVersions(id)).map((v) => v.text)).toContain('my edit');
  });
});
