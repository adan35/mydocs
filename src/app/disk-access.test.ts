import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryProvider } from '@/storage/memory';
import { Workspace, setWriteGuard } from './workspace';
import { WorkspaceSession } from './session';
import { useApp } from './app-store';
import { useRouter } from './router';
import { useToasts } from './toast-store';
import { diskLinks, useDiskLinks } from './disk-links';
import { folderSync, useFolderLinks } from './folder-sync';
import { accessPlan, allowAllDiskAccess, allowDiskAccess, watchDiskAccess } from './disk-access';

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

  it('one click asks at most a few prompts, however many files wait', async () => {
    const grants: Grant[] = [];
    const ids: string[] = [];
    for (let i = 0; i < 8; i++) {
      const e = await workspace.createFile(null, `f${i}.md`, 'x');
      const grant: Grant = { state: 'prompt', asked: 0 };
      await diskLinks.link(e.id, fileHandle(`f${i}.md`, grant));
      grants.push(grant);
      ids.push(e.id);
    }
    restarted(ids);
    await allowDiskAccess();
    expect(grants.reduce((n, g) => n + g.asked, 0)).toBe(3);
    expect(diskLinks.needingPermission()).toHaveLength(5);
  });

  it('a click in a document asks only its own folder, not every folder waiting', async () => {
    const mine: Grant = { state: 'prompt', asked: 0 };
    const other: Grant = { state: 'prompt', asked: 0 };
    const a = await workspace.createFolder(null, 'a');
    const b = await workspace.createFolder(null, 'b');
    await folderSync.link(a.id, folderHandle('a', mine));
    await folderSync.link(b.id, folderHandle('b', other));
    const doc = await workspace.createFile(a.id, 'x.md', 'x');
    await diskLinks.link(doc.id, fileHandle('x.md', { state: 'prompt', asked: 0 }, mine));
    restarted([doc.id]);
    useFolderLinks.setState((st) => ({
      links: {
        ...st.links,
        [a.id]: { ...st.links[a.id]!, state: 'needs-permission' },
        [b.id]: { ...st.links[b.id]!, state: 'needs-permission' },
      },
    }));
    await allowDiskAccess([doc.id]);
    expect([mine.asked, other.asked]).toEqual([1, 0]);
  });

  describe('a prompt nobody answers', () => {
    afterEach(() => vi.useRealTimers());

    it('stops waiting instead of holding the app', async () => {
      vi.useFakeTimers();
      const e = await workspace.createFile(null, 'a.md', 'a');
      const h = fileHandle('a.md', { state: 'prompt', asked: 0 });
      (h as unknown as { requestPermission: () => Promise<never> }).requestPermission = () =>
        new Promise(() => {});
      await diskLinks.link(e.id, h);
      restarted([e.id]);
      const result = allowDiskAccess();
      await vi.advanceTimersByTimeAsync(31_000);
      expect(await result).toBe(false);
      expect(state(e.id)).toBe('needs-permission');
    });
  });
});

/**
 * A folder the person picked: it finds the files inside it again, and the handles it gives
 * back are allowed (they carry the folder's permission) while the stored ones are not.
 */
function pickedFolder(inside: Record<string, FileSystemFileHandle>) {
  const paths = new Map(Object.entries(inside).map(([path, h]) => [h, path.split('/')]));
  const byPath = new Map(Object.entries(inside));
  const dirs = new Set(Object.keys(inside).flatMap((p) => p.split('/').slice(0, -1)));
  return {
    kind: 'directory',
    name: 'picked',
    queryPermission: async () => 'granted',
    requestPermission: async () => 'granted',
    resolve: async (h: FileSystemHandle) => paths.get(h as never) ?? null,
    getDirectoryHandle: async (n: string) => {
      if (!dirs.has(n)) throw new DOMException('no', 'NotFoundError');
      return pickedFolder(
        Object.fromEntries(
          [...byPath]
            .filter(([p]) => p.startsWith(`${n}/`))
            .map(([p, h]) => [p.slice(n.length + 1), h]),
        ),
      );
    },
    getFileHandle: async (n: string) => ({
      ...byPath.get(n)!,
      queryPermission: async () => 'granted',
      requestPermission: async () => 'granted',
    }),
  } as unknown as FileSystemDirectoryHandle;
}

describe('Allow all', () => {
  it('one folder pick restores every file inside it, with no prompt per file', async () => {
    const grants: Grant[] = [];
    const inside: Record<string, FileSystemFileHandle> = {};
    const ids: string[] = [];
    for (let i = 0; i < 50; i++) {
      const name = `f${i}.md`;
      const e = await workspace.createFile(null, name, name);
      const grant: Grant = { state: 'prompt', asked: 0 };
      const h = fileHandle(name, grant);
      await diskLinks.link(e.id, h);
      grants.push(grant);
      inside[`sub/${name}`] = h;
      ids.push(e.id);
    }
    // One file lies outside the picked folder.
    const out = await workspace.createFile(null, 'out.md', 'out');
    await diskLinks.link(out.id, fileHandle('out.md', { state: 'prompt', asked: 0 }));
    restarted([...ids, out.id]);

    let picked = 0;
    const root = pickedFolder(inside);
    (window as unknown as Record<string, unknown>).showDirectoryPicker = async () => {
      picked++;
      return root;
    };
    await allowAllDiskAccess();

    expect(picked).toBe(1);
    expect(grants.reduce((n, g) => n + g.asked, 0)).toBe(0);
    expect(ids.every((id) => state(id) === 'synced')).toBe(true);
    expect(state(out.id)).toBe('needs-permission');
    const toast = useToasts.getState().toasts.at(-1)!;
    expect(toast.message).toBe('Allowed 50 of 51 linked items.');
    expect(toast.action?.label).toBe('Choose another folder');
  });

  it('an edit made while access was missing is saved through the restored handle', async () => {
    const a = await workspace.createFile(null, 'a.md', 'a');
    const b = await workspace.createFile(null, 'b.md', 'b');
    const ha = fileHandle('a.md', { state: 'prompt', asked: 0 });
    const hb = fileHandle('b.md', { state: 'prompt', asked: 0 });
    await diskLinks.link(a.id, ha);
    await diskLinks.link(b.id, hb);
    restarted([a.id, b.id]);
    await diskLinks.write(a.id, 'edited');
    expect(state(a.id)).toBe('needs-permission');
    const root = pickedFolder({ 'a.md': ha, 'b.md': hb });
    (window as unknown as Record<string, unknown>).showDirectoryPicker = async () => root;
    await allowAllDiskAccess();
    expect(state(a.id)).toBe('synced');
    expect(await (await ha.getFile()).text()).toBe('edited');
  });

  it('cancelling the picker changes nothing', async () => {
    const ids: string[] = [];
    for (const name of ['a.md', 'b.md']) {
      const e = await workspace.createFile(null, name, name);
      await diskLinks.link(e.id, fileHandle(name, { state: 'prompt', asked: 0 }));
      ids.push(e.id);
    }
    restarted(ids);
    (window as unknown as Record<string, unknown>).showDirectoryPicker = async () => {
      throw new DOMException('cancelled', 'AbortError');
    };
    await allowAllDiskAccess();
    expect(diskLinks.needingPermission()).toHaveLength(2);
    expect(useToasts.getState().toasts).toHaveLength(0);
  });

  it('a single folder is asked directly, with no picker', async () => {
    const folderGrant: Grant = { state: 'prompt', asked: 0 };
    const proj = await workspace.createFolder(null, 'proj');
    await folderSync.link(proj.id, folderHandle('proj', folderGrant));
    const ids: string[] = [];
    for (const name of ['a.md', 'b.md']) {
      const e = await workspace.createFile(proj.id, name, name);
      await diskLinks.link(e.id, fileHandle(name, { state: 'prompt', asked: 0 }, folderGrant));
      ids.push(e.id);
    }
    restarted(ids);
    useFolderLinks.setState((st) => ({
      links: { ...st.links, [proj.id]: { ...st.links[proj.id]!, state: 'needs-permission' } },
    }));
    let picked = 0;
    (window as unknown as Record<string, unknown>).showDirectoryPicker = async () => {
      picked++;
      throw new DOMException('no', 'AbortError');
    };
    await allowAllDiskAccess();
    expect(picked).toBe(0);
    expect(folderGrant.asked).toBe(1);
    expect(ids.map(state)).toEqual(['synced', 'synced']);
  });
});
