import { beforeEach, describe, expect, it } from 'vitest';
import { MemoryProvider, type MemoryWorkspaceStore } from '@/storage/memory';
import { IndexedDbProvider } from '@/storage/indexeddb';
import { Workspace, MAX_VERSIONS_PER_DOC } from './workspace';
import { WorkspaceSession } from './session';
import { importItems, readAsTextIfText } from './importer';
import { buildZip } from './exporter';
import { unzipSync, strFromU8, zipSync, strToU8 } from 'fflate';

async function openWs() {
  const provider = new MemoryProvider();
  const info = await provider.create('Test');
  const store = (await provider.open(info.id)) as MemoryWorkspaceStore;
  return { ws: await Workspace.open(store), store };
}

describe('Workspace', () => {
  let ws: Workspace;
  let store: MemoryWorkspaceStore;
  beforeEach(async () => ({ ws, store } = await openWs()));

  it('creates files and folders with unique names', async () => {
    const f = await ws.createFolder(null, 'Docs');
    const a = await ws.createFile(f.id, 'a.md', '# A');
    const b = await ws.createFile(f.id, 'A.md', '# B');
    expect(a.name).toBe('a.md');
    expect(b.name).toBe('A (2).md');
    expect(await ws.readText(b.id)).toBe('# B');
    await expect(ws.createFile(f.id, 'bad/name.md')).rejects.toThrow(/slashes/);
    await expect(ws.createFolder(f.id, 'a.md', { uniquify: false })).rejects.toThrow(
      /already exists/,
    );
  });

  it('persists atomically and survives reopen', async () => {
    const d = await ws.createFile(null, 'x.md', 'hello');
    await ws.saveText(d.id, 'hello world');
    const reopened = await Workspace.open(store);
    expect(await reopened.readText(d.id)).toBe('hello world');
    expect(reopened.get(d.id)?.size).toBe(11);
  });

  it('keeps memory consistent when a write fails', async () => {
    const d = await ws.createFile(null, 'x.md', 'one');
    store.failNextCommit = true;
    await expect(ws.saveText(d.id, 'two')).rejects.toThrow();
    expect(await ws.readText(d.id)).toBe('one');
    await ws.saveText(d.id, 'two');
    expect(await ws.readText(d.id)).toBe('two');
  });

  it('rewrites links when documents move or are renamed', async () => {
    const docs = await ws.createFolder(null, 'docs');
    const api = await ws.createFile(docs.id, 'API.md', '# API\n\nBack to [readme](../README.md).');
    const readme = await ws.createFile(
      null,
      'README.md',
      'See [API](./docs/API.md#auth) and [[API]].',
    );
    const archive = await ws.createFolder(null, 'Archive Area');

    await ws.move([api.id], archive.id);
    expect(await ws.readText(readme.id)).toBe(
      'See [API](./Archive%20Area/API.md#auth) and [[API]].',
    );
    expect(await ws.readText(api.id)).toBe('# API\n\nBack to [readme](../README.md).');

    await ws.rename(api.id, 'Reference.md');
    expect(await ws.readText(readme.id)).toBe(
      'See [API](./Archive%20Area/Reference.md#auth) and [[Reference]].',
    );

    await ws.move([readme.id], docs.id);
    expect(await ws.readText(readme.id)).toBe(
      'See [API](../Archive%20Area/Reference.md#auth) and [[Reference]].',
    );
    expect(await ws.readText(api.id)).toBe('# API\n\nBack to [readme](../docs/README.md).');
  });

  it('rewrites ![[embeds]] of notes and images on rename', async () => {
    await ws.createFile(null, 'Methodology.md', '# Methodology\n\n## Sampling\n');
    const pic = await ws.createFile(null, 'photo.png', '');
    const note = await ws.createFile(
      null,
      'Notes.md',
      '![[Methodology#Sampling]] and [[Methodology]] and ![[photo.png]]',
    );
    const methodology = ws.tree.findByPath('Methodology.md')!;
    await ws.rename(methodology.id, 'Methods.md');
    await ws.rename(pic.id, 'site.png');
    expect(await ws.readText(note.id)).toBe(
      '![[Methods#Sampling]] and [[Methods]] and ![[site.png]]',
    );
  });

  it('refuses to move a folder into its own descendant', async () => {
    const a = await ws.createFolder(null, 'A');
    const b = await ws.createFolder(a.id, 'B');
    await expect(ws.move([a.id], b.id)).rejects.toThrow(/into itself/);
    expect(ws.get(a.id)?.parentId).toBeNull();
  });

  it('trashes, restores and permanently deletes', async () => {
    const f = await ws.createFolder(null, 'F');
    const d = await ws.createFile(f.id, 'd.md', 'x');
    await ws.trash([f.id, d.id]);
    expect(ws.tree.isTrashed(d.id)).toBe(true);
    expect(ws.tree.trashedRoots().map((e) => e.id)).toEqual([f.id]);
    await ws.restore([f.id]);
    expect(ws.tree.isTrashed(d.id)).toBe(false);
    await ws.trash([f.id]);
    await ws.deletePermanently([f.id]);
    expect(ws.get(d.id)).toBeUndefined();
    expect(store.contents.has(d.id)).toBe(false);
  });

  it('restores to root when the original folder is gone, avoiding name clashes', async () => {
    const f = await ws.createFolder(null, 'F');
    const d = await ws.createFile(f.id, 'n.md', 'x');
    await ws.createFile(null, 'n.md', 'y');
    await ws.trash([d.id]);
    await ws.trash([f.id]);
    await ws.deletePermanently([f.id]);
    // d was trashed separately but lived inside f; deleting f removed it as a descendant.
    expect(ws.get(d.id)).toBeUndefined();
    const g = await ws.createFolder(null, 'G');
    const e = await ws.createFile(g.id, 'n.md', 'z');
    await ws.trash([e.id]);
    await ws.trash([g.id]);
    const [restored] = await ws.restore([e.id]);
    expect(restored?.parentId).toBeNull();
    expect(restored?.name).toBe('n (2).md');
  });

  it('restores a separately trashed child into its folder when both come back together', async () => {
    const g = await ws.createFolder(null, 'Guides');
    const d = await ws.createFile(g.id, 'guide.md', 'x');
    await ws.trash([d.id]);
    await ws.trash([g.id]);
    await ws.restore([d.id, g.id]);
    expect(ws.get(d.id)?.parentId).toBe(g.id);
    expect(ws.tree.isTrashed(d.id)).toBe(false);
  });

  it('duplicates folders deeply', async () => {
    const f = await ws.createFolder(null, 'F');
    await ws.createFile(f.id, 'a.md', 'A');
    const copy = await ws.duplicate(f.id);
    expect(copy.name).toBe('F copy');
    const kids = ws.tree.childrenOf(copy.id);
    expect(kids.map((k) => k.name)).toEqual(['a.md']);
    expect(await ws.readText(kids[0]!.id)).toBe('A');
  });

  it('snapshots versions, caps them and restores', async () => {
    const d = await ws.createFile(null, 'v.md', 'v1');
    await ws.saveText(d.id, 'v2');
    await ws.saveText(d.id, 'v3'); // within the interval: no new snapshot
    let versions = await ws.listVersions(d.id);
    expect(versions.map((v) => v.text)).toEqual(['v1']);
    await ws.restoreVersion(d.id, versions[0]!.id);
    expect(await ws.readText(d.id)).toBe('v1');
    versions = await ws.listVersions(d.id);
    expect(versions.map((v) => v.text)).toContain('v3');
    for (let i = 0; i < MAX_VERSIONS_PER_DOC + 5; i++) await ws.saveText(d.id, `x${i}`, 'recovery');
    expect((await ws.listVersions(d.id)).length).toBeLessThanOrEqual(MAX_VERSIONS_PER_DOC);
  });

  it('edits tags in documents', async () => {
    const d = await ws.createFile(null, 't.md', 'Hello #a');
    await ws.addTag(d.id, 'b');
    await ws.renameTag([d.id], 'a', 'c');
    const text = await ws.readText(d.id);
    expect(text).toContain('#c');
    expect(text).toContain('- b');
  });
});

describe('WorkspaceSession indexes', () => {
  it('searches content, names and tags, and finds backlinks', async () => {
    const { ws } = await openWs();
    const s = new WorkspaceSession(ws);
    await s.ready;
    const docs = await ws.createFolder(null, 'Backend');
    const auth = await ws.createFile(
      docs.id,
      'AUTHENTICATION.md',
      '# Auth\n\nThe authentication service validates tokens. #security',
    );
    const readme = await ws.createFile(
      null,
      'README.md',
      'Read [auth](./Backend/AUTHENTICATION.md).',
    );
    const hits = s.search.search('validates', ws.tree);
    expect(hits[0]?.id).toBe(auth.id);
    expect(hits[0]?.snippet?.text).toContain('authentication service validates');
    expect(s.search.search('authen', ws.tree)[0]?.id).toBe(auth.id); // prefix
    expect(s.search.search('authenticaton', ws.tree)[0]?.id).toBe(auth.id); // fuzzy
    expect(s.search.search('security', ws.tree, { tag: 'security' })[0]?.id).toBe(auth.id);
    expect(s.knowledge.backlinks(ws.tree, auth.id)).toEqual([readme.id]);
    await ws.trash([auth.id]);
    expect(s.search.search('validates', ws.tree)).toEqual([]);
  });
});

describe('import / export', () => {
  it('imports nested folders, resolves conflicts and blocks traversal', async () => {
    const { ws } = await openWs();
    const file = (s: string) => new Blob([s]);
    const items = [
      { path: 'project/README.md', file: file('# Readme') },
      { path: 'project/docs/API.md', file: file('# API') },
      { path: 'project/notes/TODO.md', file: file('- [ ] x') },
      { path: '../../evil.md', file: file('x') },
      { path: 'project/node_modules/pkg/index.js', file: file('x') },
      {
        path: 'project/img.png',
        file: new Blob([new Uint8Array([137, 80, 78, 71, 0, 1])], { type: 'image/png' }),
      },
    ];
    const r1 = await importItems(ws, null, items, async () => ({
      action: 'keep-both',
      applyToAll: true,
    }));
    expect(r1.files).toBe(4);
    expect(r1.skipped.map((s) => s.reason)).toEqual(['Unsafe path.']);
    expect(ws.tree.findByPath('project/docs/API.md')).toBeTruthy();
    expect(ws.tree.findByPath('project/img.png')?.encoding).toBe('binary');
    expect(ws.tree.findByPath('project/node_modules/pkg/index.js')).toBeUndefined();

    const r2 = await importItems(
      ws,
      null,
      [{ path: 'project/README.md', file: file('# New') }],
      async () => ({ action: 'replace', applyToAll: false }),
    );
    expect(r2.replaced).toBe(1);
    expect(await ws.readText(ws.tree.findByPath('project/README.md')!.id)).toBe('# New');

    const r3 = await importItems(
      ws,
      null,
      [{ path: 'project/README.md', file: file('# Third') }],
      async () => ({ action: 'keep-both', applyToAll: false }),
    );
    expect(r3.files).toBe(1);
    expect(ws.tree.findByPath('project/README (2).md')).toBeTruthy();
  });

  it('asks about duplicates inside one import and batches new files', async () => {
    const { ws } = await openWs();
    const asked: string[] = [];
    let treeEvents = 0;
    ws.subscribe((e) => void (e.type === 'tree' && treeEvents++));
    const items = [
      ...Array.from({ length: 300 }, (_, i) => ({ path: `n/${i}.md`, file: new Blob([`${i}`]) })),
      { path: 'n/0.md', file: new Blob(['dup']) },
    ];
    const r = await importItems(ws, null, items, async (name) => {
      asked.push(name);
      return { action: 'keep-both', applyToAll: false };
    });
    expect(asked).toEqual(['0.md']);
    expect(r.files).toBe(301);
    expect(ws.tree.findByPath('n/0 (2).md')).toBeTruthy();
    expect(await ws.readText(ws.tree.findByPath('n/299.md')!.id)).toBe('299');
    // One folder plus a handful of batches, not one event per file.
    expect(treeEvents).toBeLessThan(10);
  });

  it('imports zip archives without zip-slip', async () => {
    const { ws } = await openWs();
    const zip = zipSync({ 'a/b.md': strToU8('# B'), '../escape.md': strToU8('x') });
    const r = await importItems(
      ws,
      null,
      [{ path: 'arch.zip', file: new Blob([zip]) }],
      async () => ({ action: 'skip', applyToAll: true }),
    );
    expect(ws.tree.findByPath('arch/a/b.md')).toBeTruthy();
    expect(r.skipped.some((s) => s.reason === 'Unsafe path.')).toBe(true);
  });

  it('exports a zip with structure, excluding trash', async () => {
    const { ws } = await openWs();
    const f = await ws.createFolder(null, 'F');
    await ws.createFile(f.id, 'a.md', 'A');
    const t = await ws.createFile(null, 'gone.md', 'G');
    await ws.createFolder(null, 'Empty');
    await ws.trash([t.id]);
    const files = unzipSync(await buildZip(ws, null));
    expect(Object.keys(files).sort()).toEqual(['Empty/', 'F/a.md']);
    expect(strFromU8(files['F/a.md']!)).toBe('A');
  });

  it('detects text vs binary', async () => {
    expect(await readAsTextIfText(new Blob(['﻿hello']), 'x.md')).toBe('hello');
    expect(await readAsTextIfText(new Blob([new Uint8Array([0, 1, 2])]), 'blob.bin')).toBeNull();
    expect(await readAsTextIfText(new Blob(['plain']), 'LICENSE')).toBe('plain');
  });
});

describe('IndexedDB provider', () => {
  it('round-trips a workspace', async () => {
    const provider = new IndexedDbProvider();
    const info = await provider.create('IDB');
    const ws = await Workspace.open(await provider.open(info.id));
    const d = await ws.createFile(null, 'x.md', 'idb');
    await ws.saveText(d.id, 'idb 2');
    ws.store.close();
    const again = await Workspace.open(await provider.open(info.id));
    expect(await again.readText(d.id)).toBe('idb 2');
    expect((await provider.list()).map((w) => w.name)).toContain('IDB');
    again.store.close();
    await provider.remove(info.id);
    expect((await provider.list()).map((w) => w.id)).not.toContain(info.id);
  });
});
