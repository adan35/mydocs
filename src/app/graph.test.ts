import { describe, expect, it } from 'vitest';
import { MemoryProvider } from '@/storage/memory';
import { Workspace } from './workspace';
import { WorkspaceSession } from './session';
import { buildGraph, ghostId } from './graph';

async function setup() {
  const provider = new MemoryProvider();
  const info = await provider.create('Test');
  const ws = await Workspace.open(await provider.open(info.id));
  const s = new WorkspaceSession(ws);
  await s.ready;
  return { ws, s };
}

describe('graph', () => {
  it('draws only real links, adds missing targets and suggestions on request', async () => {
    const { ws, s } = await setup();
    const a = await ws.createFile(
      null,
      'Alpha.md',
      'See [[Beta]] and [[Gamma]] and [web](https://x.y).',
    );
    const b = await ws.createFile(null, 'Beta.md', 'Back to [alpha](./Alpha.md).');
    const c = await ws.createFile(null, 'Delta.md', 'Delta talks about Alpha in passing.');
    const plain = buildGraph(ws.tree, s.knowledge, {});
    expect(new Set(plain.ids)).toEqual(new Set([a.id, b.id]));
    expect(plain.edges).toHaveLength(1);
    expect(plain.suggested).toHaveLength(0);

    const full = buildGraph(ws.tree, s.knowledge, {
      unresolved: true,
      suggested: ws.allTexts(),
    });
    const gamma = full.ids.indexOf(ghostId('Gamma'));
    expect(gamma).toBeGreaterThan(-1);
    expect(full.kinds[gamma]).toBe('ghost');
    expect(full.ghosts.get(ghostId('Gamma'))).toMatchObject({ from: a.id, kind: 'wiki' });
    // External links never become nodes.
    expect(full.ids.some((id) => id.includes('x.y'))).toBe(false);
    // Delta names Alpha without linking: a suggested edge, not a link.
    const [x, y] = full.suggested[0]!;
    expect(new Set([full.ids[x], full.ids[y]])).toEqual(new Set([a.id, c.id]));
    expect(full.edges).toHaveLength(2);
  });

  it('tells documents with the same name apart and reports ambiguous wiki links', async () => {
    const { ws, s } = await setup();
    const one = await ws.createFolder(null, 'One');
    const two = await ws.createFolder(null, 'Two');
    const n1 = await ws.createFile(one.id, 'Notes.md', 'x');
    const n2 = await ws.createFile(two.id, 'Notes.md', 'y');
    const hub = await ws.createFile(
      null,
      'Hub.md',
      '[[One/Notes]] and [[Two/Notes]] and [[Notes]]',
    );
    const g = buildGraph(ws.tree, s.knowledge, {});
    expect(g.labels[g.ids.indexOf(n1.id)]).toBe('Notes (One)');
    expect(g.labels[g.ids.indexOf(n2.id)]).toBe('Notes (Two)');
    const amb = s.knowledge.ambiguousLinks(ws.tree, hub.id);
    expect(amb.map((a) => a.link.target)).toEqual(['Notes']);
    expect(new Set(amb[0]!.candidates)).toEqual(new Set([n1.id, n2.id]));
  });

  it('keeps backlinks current through edits, renames and trash', async () => {
    const { ws, s } = await setup();
    const t = await ws.createFile(null, 'Target.md', '# T');
    const f = await ws.createFile(null, 'From.md', 'nothing yet');
    expect(s.knowledge.backlinks(ws.tree, t.id)).toEqual([]);
    await ws.saveText(f.id, 'now [[Target]]');
    expect(s.knowledge.backlinks(ws.tree, t.id)).toEqual([f.id]);
    await ws.rename(t.id, 'Renamed.md');
    // The workspace rewrites the link, so the backlink survives the rename.
    expect(await ws.readText(f.id)).toContain('[[Renamed]]');
    expect(s.knowledge.backlinks(ws.tree, t.id)).toEqual([f.id]);
    await ws.trash([f.id]);
    expect(s.knowledge.backlinks(ws.tree, t.id)).toEqual([]);
  });

  it('builds a local graph to the requested depth', async () => {
    const { ws, s } = await setup();
    const a = await ws.createFile(null, 'A.md', '[[B]]');
    const b = await ws.createFile(null, 'B.md', '[[C]]');
    const c = await ws.createFile(null, 'C.md', '[[D]]');
    const d = await ws.createFile(null, 'D.md', '');
    expect(new Set(buildGraph(ws.tree, s.knowledge, { focusId: a.id, depth: 1 }).ids)).toEqual(
      new Set([a.id, b.id]),
    );
    expect(new Set(buildGraph(ws.tree, s.knowledge, { focusId: a.id, depth: 3 }).ids)).toEqual(
      new Set([a.id, b.id, c.id, d.id]),
    );
  });

  it('includes linked Word, spreadsheet and PDF files and filters by type', async () => {
    const { ws, s } = await setup();
    const sheet = await ws.createFile(null, 'Budget.xlsx', new Blob([new Uint8Array([1])]));
    const pdf = await ws.createFile(null, 'Scan.pdf', new Blob([new Uint8Array([1])]));
    await ws.createFile(null, 'Logo.png', new Blob([new Uint8Array([1])]));
    const md = await ws.createFile(
      null,
      'Plan.md',
      'See [budget](./Budget.xlsx) and [[Scan.pdf]].',
    );
    const g = buildGraph(ws.tree, s.knowledge, {});
    expect(new Set(g.ids)).toEqual(new Set([md.id, sheet.id, pdf.id]));
    expect(g.types[g.ids.indexOf(sheet.id)]).toBe('sheet');
    expect(g.labels[g.ids.indexOf(pdf.id)]).toBe('Scan.pdf');
    // Filtering to spreadsheets leaves no links, so only "unlinked documents" shows it.
    expect(buildGraph(ws.tree, s.knowledge, { types: ['sheet'] }).ids).toEqual([]);
    expect(buildGraph(ws.tree, s.knowledge, { types: ['sheet'], orphans: true }).ids).toEqual([
      sheet.id,
    ]);
    expect(s.knowledge.backlinks(ws.tree, sheet.id)).toEqual([md.id]);
  });
});
