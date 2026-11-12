import { beforeEach, describe, expect, it } from 'vitest';
import { MemoryProvider } from '@/storage/memory';
import { Workspace, setWriteGuard } from './workspace';
import { WorkspaceSession } from './session';
import { useApp } from './app-store';
import { useRouter } from './router';
import { useToasts } from './toast-store';
import { diskLinks, useDiskLinks } from './disk-links';
import { folderSync, useFolderLinks } from './folder-sync';
import { accessPlan, allowDiskAccess, watchDiskAccess } from './disk-access';

/** Permission like Chrome's: a file is allowed when it or its folder is. */
interface Grant {
  state: PermissionState;
  asked: number;
}

function fileHandle(name: string, own: Grant, folder?: Grant) {
  let text = name;
  const state = () => (folder?.state === 'granted' ? 'granted' : own.state);
  return {
    kind: 'file',
    name,
    getFile: async () => new File([text], name, { lastModified: 1 }),
    createWritable: async () => ({
      write: async (t: string) => void (text = t),
      close: async () => {},
    }),
    queryPermission: async () => state(),
    requestPermission: async () => {
      own.asked++;
      own.state = 'granted';
      return state();
    },
  } as unknown as FileSystemFileHandle;
}

function folderHandle(name: string, grant: Grant) {
  return {
    kind: 'directory',
    name,
    async *values() {},
    queryPermission: async () => grant.state,
    requestPermission: async () => {
      grant.asked++;
      grant.state = 'granted';
      return grant.state;
    },
  } as unknown as FileSystemDirectoryHandle;
}

let workspace: Workspace;

beforeEach(async () => {
  setWriteGuard(() => true);
  (window as unknown as Record<string, unknown>).showOpenFilePicker = () => {};
  (window as unknown as Record<string, unknown>).showDirectoryPicker = () => {};
  const provider = new MemoryProvider();
  const info = await provider.create('Test');
  workspace = await Workspace.open(await provider.open(info.id));
  useApp.setState({ provider, session: new WorkspaceSession(workspace) });
  useToasts.setState({ toasts: [] });
  for (const id of diskLinks.linkedIds()) await diskLinks.unlink(id);
  useFolderLinks.setState({ links: {} });
});

/** What a restart leaves: links whose permission the browser hasn't given back yet. */
function restarted(ids: string[]) {
  useDiskLinks.setState((s) => {
    const links = { ...s.links };
    for (const id of ids) links[id] = { ...links[id]!, state: 'needs-permission' };
    return { links };
  });
}

const state = (id: string) => useDiskLinks.getState().links[id]?.state;

describe('disk access after a restart', () => {
  it('asks once for an imported folder, not once per file inside it', async () => {
    const folderGrant: Grant = { state: 'prompt', asked: 0 };
    const proj = await workspace.createFolder(null, 'proj');
    await folderSync.link(proj.id, folderHandle('proj', folderGrant));
    const files: { id: string; grant: Grant }[] = [];
    for (const name of ['a.md', 'b.md', 'c.md']) {
      const e = await workspace.createFile(proj.id, name, name);
      const grant: Grant = { state: 'prompt', asked: 0 };
      await diskLinks.link(e.id, fileHandle(name, grant, folderGrant));
      files.push({ id: e.id, grant });
    }
    restarted(files.map((f) => f.id));

    await allowDiskAccess();

    expect(folderGrant.asked).toBe(1);
    expect(files.map((f) => f.grant.asked)).toEqual([0, 0, 0]);
    expect(files.map((f) => state(f.id))).toEqual(['synced', 'synced', 'synced']);
  });

  it('files outside linked folders still get one prompt each', async () => {
    const grants: Grant[] = [];
    const ids: string[] = [];
    for (const name of ['a.md', 'b.md']) {
      const e = await workspace.createFile(null, name, name);
      const grant: Grant = { state: 'prompt', asked: 0 };
      await diskLinks.link(e.id, fileHandle(name, grant));
      grants.push(grant);
      ids.push(e.id);
    }
    restarted(ids);
    await allowDiskAccess();
    expect(grants.map((g) => g.asked)).toEqual([1, 1]);
    expect(ids.map(state)).toEqual(['synced', 'synced']);
  });

  it('a click in a document asks for its folder once, restoring the files next to it', async () => {
    const folderGrant: Grant = { state: 'prompt', asked: 0 };
    const proj = await workspace.createFolder(null, 'proj');
    await folderSync.link(proj.id, folderHandle('proj', folderGrant));
    const a = await workspace.createFile(proj.id, 'a.md', 'a');
    const b = await workspace.createFile(proj.id, 'b.md', 'b');
    await diskLinks.link(a.id, fileHandle('a.md', { state: 'prompt', asked: 0 }, folderGrant));
    await diskLinks.link(b.id, fileHandle('b.md', { state: 'prompt', asked: 0 }, folderGrant));
    restarted([a.id, b.id]);
    useRouter.setState({ route: { name: 'doc', id: a.id } as never });
    const stop = watchDiskAccess();
    document.dispatchEvent(new Event('pointerdown'));
    document.dispatchEvent(new Event('pointerdown'));
    stop();
    await expect.poll(() => state(b.id)).toBe('synced');
    expect(folderGrant.asked).toBe(1);
    expect(state(a.id)).toBe('synced');
  });

  it('opening or clicking a file outside a folder asks nothing; the first edit key does, once', async () => {
    const grant: Grant = { state: 'prompt', asked: 0 };
    const e = await workspace.createFile(null, 'a.md', 'a');
    await diskLinks.link(e.id, fileHandle('a.md', grant));
    restarted([e.id]);
    useRouter.setState({ route: { name: 'doc', id: e.id } as never });
    const stop = watchDiskAccess();
    document.dispatchEvent(new Event('pointerdown'));
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown' }));
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'c', ctrlKey: true }));
    await Promise.resolve();
    expect(grant.asked).toBe(0);
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'x' }));
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'y' }));
    stop();
    await expect.poll(() => state(e.id)).toBe('synced');
    expect(grant.asked).toBe(1);
  });

  it('the plan counts one prompt per folder and per file outside a folder', async () => {
    const folderGrant: Grant = { state: 'prompt', asked: 0 };
    const proj = await workspace.createFolder(null, 'proj');
    await folderSync.link(proj.id, folderHandle('proj', folderGrant));
    const ids: string[] = [];
    for (const [parent, name] of [
      [proj.id, 'in1.md'],
      [proj.id, 'in2.md'],
      [null, 'out1.md'],
      [null, 'out2.md'],
    ] as const) {
      const e = await workspace.createFile(parent, name, name);
      await diskLinks.link(e.id, fileHandle(name, { state: 'prompt', asked: 0 }, folderGrant));
      ids.push(e.id);
    }
    restarted(ids);
    useFolderLinks.setState((s) => ({
      links: { ...s.links, [proj.id]: { ...s.links[proj.id]!, state: 'needs-permission' } },
    }));
    const plan = accessPlan();
    expect(plan.folders.map((f) => f.name)).toEqual(['proj']);
    expect(plan.files.map((f) => f.name).sort()).toEqual(['out1.md', 'out2.md']);
    expect(plan.prompts).toBe(3);
  });
});
