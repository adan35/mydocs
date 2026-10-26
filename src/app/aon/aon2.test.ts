import { describe, expect, it } from 'vitest';
import type { Entry } from '@/domain/types';
import { Tree } from '@/domain/tree';
import { extractJson } from './json';
import { cleanFileName, cleanFolderPath, isTidyable } from './places';
import { describeDocs, parseOps } from './tidy';
import { parsePlan, planText } from './capture';
import { addRelatedLink } from './related';
import { collectFacts, factsText } from './brief';
import { needsBreak, openTasks } from './protocol';

const entry = (
  id: string,
  parentId: string | null,
  name: string,
  kind: 'file' | 'folder' = 'file',
  updatedAt = 1,
): Entry => ({ id, parentId, name, kind, createdAt: 1, updatedAt, size: 0 });

describe('extractJson', () => {
  it('finds JSON inside prose and fences', () => {
    expect(extractJson('Sure!\n```json\n{"a":[1,2]}\n```')).toEqual({ a: [1, 2] });
    expect(extractJson('[1,2,3] done')).toEqual([1, 2, 3]);
  });
  it('returns null when there is none or it is broken', () => {
    expect(extractJson('no json here')).toBeNull();
    expect(extractJson('{"a":')).toBeNull();
  });
});

describe('places', () => {
  it('cleans folder paths and rejects escapes and protected folders', () => {
    expect(cleanFolderPath(' Projects / Alpha ')).toBe('Projects/Alpha');
    expect(cleanFolderPath('')).toBe('');
    expect(cleanFolderPath('/')).toBe('');
    expect(cleanFolderPath('../etc')).toBeNull();
    expect(cleanFolderPath('a/b/c/d')).toBeNull();
    expect(cleanFolderPath('Notes/x')).toBeNull();
    expect(cleanFolderPath('a:b')).toBeNull();
    expect(cleanFolderPath(42)).toBeNull();
  });
  it('cleans file names and keeps the extension', () => {
    expect(cleanFileName('Plan', '.md')).toBe('Plan.md');
    expect(cleanFileName('Plan.md', '.md')).toBe('Plan.md');
    expect(cleanFileName('a/b/Plan', '.md')).toBe('Plan.md');
    expect(cleanFileName('.md', '.md')).toBeNull();
    expect(cleanFileName('x*y', '.md')).toBeNull();
    expect(cleanFileName('x'.repeat(100), '.md')).toBeNull();
  });
});

describe('tidy', () => {
  const tree = new Tree([
    entry('inbox', null, 'Inbox', 'folder'),
    entry('d1', 'inbox', 'untitled 3.md'),
    entry('d2', null, 'AON.md'),
    entry('notes', null, 'Notes', 'folder'),
    entry('n1', 'notes', 'a note.md'),
    entry('proj', null, 'Projects', 'folder'),
    entry('d3', 'proj', 'plan.md'),
  ]);
  const ok = (e: Entry) => isTidyable(tree, e);
  const noTags = () => [] as string[];

  it('only touches ordinary documents', () => {
    expect(isTidyable(tree, tree.get('d1')!)).toBe(true);
    expect(isTidyable(tree, tree.get('d2')!)).toBe(false);
    expect(isTidyable(tree, tree.get('n1')!)).toBe(false);
    expect(isTidyable(tree, tree.get('proj')!)).toBe(false);
  });

  it('keeps valid operations and drops invented, unsafe or no-op ones', () => {
    const ops = parseOps(
      {
        ops: [
          { kind: 'move', path: 'Inbox/untitled 3.md', to: 'Projects/Alpha', reason: 'fits' },
          { kind: 'rename', path: 'Inbox/untitled 3.md', name: 'Alpha kickoff', reason: 'clear' },
          { kind: 'tag', path: 'Projects/plan.md', tag: '#Planning' },
          { kind: 'tag', path: 'Projects/plan.md', tag: 'bad tag!' },
          { kind: 'move', path: 'Nope/missing.md', to: 'X' },
          { kind: 'move', path: 'AON.md', to: 'X' },
          { kind: 'move', path: 'Notes/a note.md', to: 'X' },
          { kind: 'move', path: 'Projects/plan.md', to: 'Projects' },
          { kind: 'move', path: 'Inbox/untitled 3.md', to: '../../x' },
          { kind: 'delete', path: 'Projects/plan.md' },
        ],
      },
      tree,
      ok,
      noTags,
    );
    expect(ops.map((o) => [o.kind, o.path, o.to])).toEqual([
      ['move', 'Inbox/untitled 3.md', 'Projects/Alpha'],
      ['rename', 'Inbox/untitled 3.md', 'Alpha kickoff.md'],
      ['tag', 'Projects/plan.md', 'planning'],
    ]);
  });

  it('does not add a tag the document already has, and ignores junk', () => {
    expect(
      parseOps({ ops: [{ kind: 'tag', path: 'Projects/plan.md', tag: 'x' }] }, tree, ok, () => [
        'x',
      ]),
    ).toEqual([]);
    expect(parseOps(null, tree, ok, noTags)).toEqual([]);
    expect(parseOps({ ops: 'no' }, tree, ok, noTags)).toEqual([]);
  });

  it('describes documents by path, title, tags and start', () => {
    const texts = new Map([['d3', '---\ntags: [a]\n---\n# Plan for May\n\nWe ship the beta.']]);
    expect(describeDocs(tree, texts, [tree.get('d3')!], () => ['a'])).toBe(
      'Projects/plan.md | Plan for May | #a | We ship the beta.',
    );
  });
});

describe('capture', () => {
  it('builds a safe plan from the model answer', () => {
    const p = parsePlan({
      title: 'Plumber: visit/Tuesday',
      folder: '../Home',
      tags: ['Home', 'home', 'not valid!', 'repairs'],
      markdown: '# Plumber visit\n\nTuesday 9:00',
    })!;
    expect(p.title).toBe('Plumber visit Tuesday');
    expect(p.folder).toBe('');
    expect(p.tags).toEqual(['home', 'repairs']);
    expect(planText(p)).toBe(
      '---\ntags:\n  - home\n  - repairs\n---\n# Plumber visit\n\nTuesday 9:00\n',
    );
  });
  it('has no front matter without tags, and rejects an empty answer', () => {
    expect(planText({ title: 't', folder: '', tags: [], markdown: 'x' })).toBe('x\n');
    expect(parsePlan({ title: 'x', markdown: '  ' })).toBeNull();
    expect(parsePlan('nope')).toBeNull();
  });
});

describe('related links', () => {
  it('starts a Related section, then extends it, once per link', () => {
    const a = addRelatedLink('# Doc\n\nText.', 'Other')!;
    expect(a).toBe('# Doc\n\nText.\n\n## Related\n\n- [[Other]]\n');
    expect(addRelatedLink(a, 'Third')).toBe(
      '# Doc\n\nText.\n\n## Related\n\n- [[Other]]\n- [[Third]]\n',
    );
    expect(addRelatedLink(a, 'Other')).toBeNull();
  });
  it('does not push a link into a Related section that is not last', () => {
    const t = '## Related\n\n- [[A]]\n\n## Notes\n\nmore';
    expect(addRelatedLink(t, 'B')).toBe(`${t}\n\n## Related\n\n- [[B]]\n`);
  });
});

describe('brief', () => {
  const day = 86_400_000;
  const now = 100 * day;
  const tree = new Tree([
    entry('a', null, 'Plan.md', 'file', now - day),
    entry('b', null, 'Old.md', 'file', now - 30 * day),
    entry('c', null, 'Secret.md', 'file', now - day),
  ]);
  const texts = new Map([
    ['a', 'Intro\n- [ ] send invoice\n- [x] done thing\n  * [ ] nested'],
    ['b', '- [ ] ancient'],
    ['c', '- [ ] hidden'],
  ]);
  const notes = [
    { id: 'n1', title: 'Call plumber', text: '', reminder: now - 1000, archived: false },
    { id: 'n2', title: 'Far away', text: '', reminder: now + 30 * day, archived: false },
    { id: 'n3', title: 'Archived', text: '', reminder: now, archived: true },
  ];
  it('collects what is due, open and recent, leaving out hidden and old things', () => {
    const f = collectFacts(tree, texts, notes, (id) => id !== 'c', now);
    expect(f.reminders.map((r) => r.title)).toEqual(['Call plumber']);
    expect(f.tasks.map((t) => t.text)).toEqual(['send invoice', 'nested']);
    expect(f.changed.map((c) => c.path)).toEqual(['Plan.md']);
    expect(factsText(f, now)).toContain('(overdue)');
  });
  it('reads open tasks only', () => {
    expect(openTasks('---\nx: 1\n---\n- [ ] a\n- [x] b\n* [ ] c')).toEqual(['a', 'c']);
  });
});

describe('needsBreak', () => {
  it('breaks before block text that lands mid-line', () => {
    expect(needsBreak('t', '## Summary\n- x')).toBe(true);
    expect(needsBreak('t', '- one\n- two')).toBe(true);
    expect(needsBreak('t', 'and then some')).toBe(false);
    expect(needsBreak('\n', '## Summary')).toBe(false);
    expect(needsBreak('', '## Summary')).toBe(false);
  });
});
