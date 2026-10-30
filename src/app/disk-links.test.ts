import { beforeEach, describe, expect, it } from 'vitest';
import { MemoryProvider } from '@/storage/memory';
import { Workspace, setWriteGuard } from './workspace';
import { WorkspaceSession } from './session';
import { useApp } from './app-store';
import { useRouter } from './router';
import { useToasts } from './toast-store';
import { diskLinks, useDiskLinks } from './disk-links';

/** A fake file handle whose permission starts at `state`; a request grants it unless `refuse`. */
function fakeHandle(name: string, disk: { text: string }, state: PermissionState, refuse = false) {
  const h = {
    kind: 'file',
    name,
    state,
    getFile: async () => new File([disk.text], name, { lastModified: 1 }),
    createWritable: async () => {
      let next = '';
      return {
        write: async (t: string) => void (next = t),
        close: async () => void (disk.text = next),
      };
    },
    queryPermission: async () => h.state,
    requestPermission: async () => {
      if (!refuse) h.state = 'granted';
      return h.state;
    },
  };
  return h;
}

let workspace: Workspace;

beforeEach(async () => {
  setWriteGuard(() => true);
  (window as unknown as Record<string, unknown>).showOpenFilePicker = () => {};
  const provider = new MemoryProvider();
  const info = await provider.create('Test');
  workspace = await Workspace.open(await provider.open(info.id));
  useApp.setState({ provider, session: new WorkspaceSession(workspace) });
  useToasts.setState({ toasts: [] });
  for (const id of diskLinks.linkedIds()) await diskLinks.unlink(id);
});

async function linked(name: string, text: string, state: PermissionState, refuse = false) {
  const entry = await workspace.createFile(null, name, text);
  const disk = { text };
  const handle = fakeHandle(name, disk, state, refuse);
  await diskLinks.link(entry.id, handle as unknown as FileSystemFileHandle);
  // What a restart does: the link is there but the browser hasn't granted access yet.
  useDiskLinks.setState((s) => ({
    links: { ...s.links, [entry.id]: { ...s.links[entry.id]!, state: 'needs-permission' } },
  }));
  return { id: entry.id, disk, handle };
}

const state = (id: string) => useDiskLinks.getState().links[id]?.state;

describe('disk link permission after a restart', () => {
  it('the button works even when the file already holds the same text', async () => {
    const { id, handle } = await linked('a.md', 'same', 'prompt');
    expect(await diskLinks.allow(id, 'same')).toBe(true);
    expect(handle.state).toBe('granted');
    expect(state(id)).toBe('synced');
  });

  it('writes edits made while permission was missing once it is granted', async () => {
    const { id, disk } = await linked('a.md', 'old', 'prompt');
    expect(await diskLinks.allow(id, 'edited')).toBe(true);
    expect(disk.text).toBe('edited');
  });

  it('says so when permission is refused, and keeps asking for it', async () => {
    const { id } = await linked('a.md', 'x', 'prompt', true);
    expect(await diskLinks.allow(id, 'x')).toBe(false);
    expect(state(id)).toBe('needs-permission');
    expect(useToasts.getState().toasts[0]).toMatchObject({ tone: 'error' });
  });

  it('restores quietly when the browser already allows access', async () => {
    const { id, handle } = await linked('a.md', 'x', 'granted');
    expect(state(id)).toBe('needs-permission');
    await diskLinks.check(id);
    expect(handle.state).toBe('granted');
    expect(state(id)).toBe('synced');
    expect(useToasts.getState().toasts).toHaveLength(0);
  });

  it('flushes a save that was waiting when permission comes back', async () => {
    const { id, disk, handle } = await linked('a.md', 'old', 'prompt');
    await diskLinks.write(id, 'new');
    expect(disk.text).toBe('old');
    handle.state = 'granted';
    await diskLinks.check(id);
    expect(disk.text).toBe('new');
    expect(state(id)).toBe('synced');
  });

  it('allowAll restores every file with one call', async () => {
    const a = await linked('a.md', 'a', 'prompt');
    const b = await linked('b.md', 'b', 'prompt');
    expect(diskLinks.needingPermission()).toHaveLength(2);
    await diskLinks.allowAll();
    expect([state(a.id), state(b.id)]).toEqual(['synced', 'synced']);
    expect(diskLinks.needingPermission()).toHaveLength(0);
  });

  it('the first click in the open document asks, once', async () => {
    const a = await linked('a.md', 'a', 'prompt', true);
    useRouter.setState({ route: { name: 'doc', id: a.id } as never });
    const stop = diskLinks.watch();
    let asked = 0;
    a.handle.requestPermission = async () => (asked++, a.handle.state);
    document.dispatchEvent(new Event('pointerdown'));
    document.dispatchEvent(new Event('pointerdown'));
    stop();
    expect(asked).toBe(1);
  });
});
