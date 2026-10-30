import { describe, expect, it } from 'vitest';
import { sanitizeName, uniqueName, validateName, fileTypeOf } from './names';
import { normalizePath, relativePath, resolvePath } from './paths';
import { extractTags, addTag, replaceTag, removeTag } from './tags';
import { extractHeadings } from './outline';
import { extractExternalLinks, extractLinks, rewriteLinks } from './links';
import { Tree, sortEntries } from './tree';
import type { Entry } from './types';
import { expandTemplate } from './templates';
import { diffLines, hunks, pairRows, summarizeChange } from './diff';

const entry = (
  id: string,
  parentId: string | null,
  name: string,
  kind: 'file' | 'folder' = 'file',
  extra: Partial<Entry> = {},
): Entry => ({
  id,
  parentId,
  name,
  kind,
  createdAt: 1,
  updatedAt: 1,
  size: 0,
  ...extra,
});

describe('names', () => {
  it('validates names', () => {
    expect(validateName('')).toBe('empty');
    expect(validateName('a/b')).toBe('invalid-chars');
    expect(validateName('a\\b')).toBe('invalid-chars');
    expect(validateName('..')).toBe('reserved');
    expect(validateName('x'.repeat(201))).toBe('too-long');
    expect(validateName('Résumé 2024 (final).md')).toBeNull();
  });
  it('sanitizes untrusted names', () => {
    expect(sanitizeName('../../etc/passwd')).toBe('..-..-etc-passwd');
    expect(sanitizeName('a\u0000b')).toBe('a-b');
    expect(sanitizeName('  ')).toBe('Untitled');
  });
  it('generates unique names case-insensitively', () => {
    expect(uniqueName('Notes.md', ['notes.md'])).toBe('Notes (2).md');
    expect(uniqueName('Notes.md', ['notes.md', 'Notes (2).md'])).toBe('Notes (3).md');
    expect(uniqueName('Folder', ['Folder'])).toBe('Folder (2)');
    expect(uniqueName('Notes (2).md', ['Notes (2).md'])).toBe('Notes (3).md');
  });
  it('detects file types', () => {
    expect(fileTypeOf('a.md')).toBe('markdown');
    expect(fileTypeOf('a.MDX')).toBe('markdown');
    expect(fileTypeOf('a.tsx')).toBe('code');
    expect(fileTypeOf('a.yml')).toBe('data');
    expect(fileTypeOf('a.png')).toBe('image');
    expect(fileTypeOf('a.exe')).toBe('binary');
  });
});

describe('paths', () => {
  it('normalizes and blocks traversal', () => {
    expect(normalizePath('a/./b/../c')).toBe('a/c');
    expect(normalizePath('../x')).toBeNull();
    expect(normalizePath('a\\b')).toBe('a/b');
  });
  it('resolves relative links', () => {
    expect(resolvePath('docs', './api.md')).toBe('docs/api.md');
    expect(resolvePath('docs/sub', '../README.md')).toBe('docs/README.md');
    expect(resolvePath('docs', '/README.md')).toBe('README.md');
    expect(resolvePath('', '../x.md')).toBeNull();
  });
  it('computes relative paths', () => {
    expect(relativePath('docs', 'docs/api.md')).toBe('./api.md');
    expect(relativePath('docs/a', 'docs/b/c.md')).toBe('../b/c.md');
    expect(relativePath('', 'x/y.md')).toBe('./x/y.md');
    expect(relativePath('a', 'b.md')).toBe('../b.md');
  });
});

describe('tags', () => {
  it('extracts inline and front-matter tags, skipping code and headings', () => {
    const src = `---\ntags: [Work, plan]\n---\n# Heading\n\nHello #todo and #backend/api.\n\n\`#notatag\`\n\n\`\`\`\n#nope\n\`\`\`\n[x](#anchor) #2024 issue#3`;
    expect(extractTags(src)).toEqual(['backend/api', 'plan', 'todo', 'work']);
  });
  it('adds, renames and removes tags', () => {
    const added = addTag('# Doc\n\ntext #old', 'new');
    expect(extractTags(added)).toEqual(['new', 'old']);
    const renamed = replaceTag(added, 'old', 'fresh');
    expect(extractTags(renamed)).toEqual(['fresh', 'new']);
    expect(renamed).toContain('text #fresh');
    const removed = removeTag(renamed, 'new');
    expect(extractTags(removed)).toEqual(['fresh']);
    expect(removed.startsWith('---')).toBe(false);
  });
});

describe('outline', () => {
  it('extracts headings with unique slugs and lines', () => {
    const h = extractHeadings(
      '# Intro\n\n## Setup\n\n```\n# not heading\n```\n\n## Setup\n\nTitle\n=====\n',
    );
    expect(h.map((x) => [x.level, x.text, x.slug, x.line])).toEqual([
      [1, 'Intro', 'intro', 0],
      [2, 'Setup', 'setup', 2],
      [2, 'Setup', 'setup-1', 8],
      [1, 'Title', 'title', 10],
    ]);
  });
});

describe('links', () => {
  it('extracts internal links only', () => {
    const links = extractLinks(
      '[a](./a.md) [b](https://x.com) ![i](img/p.png) [[Wiki Page|alias]] [c](<my file.md#sec>) `[d](d.md)`',
    );
    expect(links.map((l) => [l.kind, l.target, l.fragment])).toEqual([
      ['markdown', './a.md', undefined],
      ['image', 'img/p.png', undefined],
      ['wiki', 'Wiki Page', undefined],
      ['markdown', 'my file.md', 'sec'],
    ]);
  });
  it('extracts web links once each, skipping code, images and unsafe schemes', () => {
    const links = extractExternalLinks(
      '| [Tauri 2](https://tauri.app) | <https://x.com> ![i](https://i.png) `[c](https://c.com)` [j](javascript:alert(1)) [again](https://tauri.app)',
    );
    expect(links).toEqual([
      { href: 'https://tauri.app', label: 'Tauri 2' },
      { href: 'https://x.com', label: 'https://x.com' },
    ]);
  });
  it('treats ![[embeds]] as wiki links', () => {
    const links = extractLinks('![[photo.png]] ![[Note#Part]]');
    expect(links.map((l) => [l.kind, l.target, l.fragment, l.embed])).toEqual([
      ['wiki', 'photo.png', undefined, true],
      ['wiki', 'Note', 'Part', true],
    ]);
  });
  it('rewrites link targets in place', () => {
    const out = rewriteLinks('see [a](./a.md#x) and [[A]]', (l) =>
      l.kind === 'markdown' ? '../b/a.md' : 'B',
    );
    expect(out).toBe('see [a](../b/a.md#x) and [[B]]');
  });
  it('rewrites a wiki link that comes before a Markdown link on the same line', () => {
    // Regression: links were rewritten out of order and the text was duplicated.
    const out = rewriteLinks('See [[Target]] and [the target](./Target.md).', (l) =>
      l.kind === 'wiki' ? 'Renamed' : './Renamed.md',
    );
    expect(out).toBe('See [[Renamed]] and [the target](./Renamed.md).');
  });
});

describe('tree', () => {
  const tree = new Tree([
    entry('f1', null, 'Projects', 'folder'),
    entry('f2', 'f1', 'Alpha', 'folder'),
    entry('d1', 'f2', 'README.md'),
    entry('d2', null, 'notes.md'),
    entry('t1', 'f1', 'Old', 'folder', { trashedAt: 5 }),
    entry('d3', 't1', 'inside.md'),
  ]);
  it('computes paths and lookups', () => {
    expect(tree.pathOf('d1')).toBe('Projects/Alpha/README.md');
    expect(tree.findByPath('projects/alpha/readme.md')?.id).toBe('d1');
    expect(tree.childrenOf(null).map((e) => e.name)).toEqual(['Projects', 'notes.md']);
  });
  it('tracks trash through ancestors', () => {
    expect(tree.isTrashed('d3')).toBe(true);
    expect(tree.isTrashed('d1')).toBe(false);
    expect(tree.findByPath('Projects/Old/inside.md')).toBeUndefined();
    expect(tree.trashedRoots().map((e) => e.id)).toEqual(['t1']);
  });
  it('prevents moving a folder into itself', () => {
    expect(tree.canMove('f1', 'f2')).toBe(false);
    expect(tree.canMove('f1', 'f1')).toBe(false);
    expect(tree.canMove('f2', null)).toBe(true);
    expect(tree.canMove('d1', 't1')).toBe(false);
  });
  it('sorts with folders first', () => {
    const sorted = sortEntries(
      [
        entry('a', null, 'b.md', 'file', { size: 5 }),
        entry('b', null, 'Z', 'folder'),
        entry('c', null, 'a.md', 'file', { size: 9 }),
      ],
      'size',
      'desc',
    );
    expect(sorted.map((e) => e.name)).toEqual(['Z', 'a.md', 'b.md']);
  });
});

describe('templates', () => {
  it('expands variables', () => {
    expect(expandTemplate('# {{title}} {{ date }}', { title: 'X', date: '2024-01-01' })).toBe(
      '# X 2024-01-01',
    );
  });
});

describe('summarizeChange', () => {
  it('names the section and counts lines like a commit', () => {
    const before = '# Doc\n\n## Setup\n\nOld step\n\n## Usage\n\nRun it';
    expect(summarizeChange(before, before.replace('Old step', 'New step'))).toEqual({
      added: 1,
      removed: 1,
      message: 'Edited in “Setup”',
    });
    expect(summarizeChange(before, before + '\n- [ ] **Ship** it')).toEqual({
      added: 1,
      removed: 0,
      message: 'Added in “Usage”',
    });
    expect(summarizeChange('Intro\n\nBye', 'Intro')).toMatchObject({
      removed: 2,
      message: 'Removed “Bye”',
    });
    expect(summarizeChange('', 'a\nb').message).toBe('Created');
    expect(summarizeChange('a', 'a').message).toBe('No text changes');
  });
});

describe('history diff layout', () => {
  const diff = diffLines('a\nb\nc\nd\ne\nf\ng\nh\ni\nj', 'a\nb\nc\nd\nE\nF\nX\ng\nh\ni\nj');

  it('folds long unchanged runs into gaps', () => {
    expect(hunks(diff, 1).map((r) => r.type)).toEqual([
      'gap',
      'same',
      'del',
      'del',
      'add',
      'add',
      'add',
      'same',
      'gap',
    ]);
    expect(hunks(diffLines('a', 'a'))).toEqual([{ type: 'gap', count: 1 }]);
  });

  it('pairs removed and added runs side by side', () => {
    const rows = pairRows(hunks(diff, 1));
    expect(rows).toHaveLength(7);
    expect(rows[2]).toMatchObject({ left: { text: 'e' }, right: { text: 'E' } });
    expect(rows[3]).toMatchObject({ left: { text: 'f' }, right: { text: 'F' } });
    expect(rows[4]).toEqual({ left: undefined, right: { type: 'add', text: 'X' } });
  });
});
