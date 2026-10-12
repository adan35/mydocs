import { describe, expect, it } from 'vitest';
import {
  afterBlock,
  blockTypeOf,
  cellRanges,
  deleteBlock,
  fenceBody,
  layoutInline,
  locateInline,
  mergeInlineEdit,
  moveBlock,
  setBlockType,
} from './source-edit';

const apply = (doc: string, c: { from: number; to: number; insert: string }) =>
  doc.slice(0, c.from) + c.insert + doc.slice(c.to);

describe('locateInline', () => {
  it('finds a heading without its markers', () => {
    const doc = 'intro\n\n## Plan ##\n';
    const r = locateInline(doc, { kind: 'heading', line: 2, end: 3, content: 'Plan' })!;
    expect(doc.slice(r.from, r.to)).toBe('Plan');
  });
  it('finds a task item after its checkbox marker', () => {
    const doc = '- [ ] ship it\n';
    const r = locateInline(doc, { kind: 'item', line: 0, end: 1, content: '[ ] ship it' })!;
    expect(doc.slice(r.from, r.to)).toBe('ship it');
    expect(r.continuation).toBe('  ');
  });
  it('finds multi-line content inside a quote and keeps its prefix for new lines', () => {
    const doc = '> first line\n> second line\n';
    const r = locateInline(doc, {
      kind: 'paragraph',
      line: 0,
      end: 2,
      content: 'first line\nsecond line',
    })!;
    expect(doc.slice(r.from, r.to)).toBe('first line\n> second line');
    expect(apply(doc, { ...r, insert: layoutInline('a\nb\nc', r, false) })).toBe('> a\n> b\n> c\n');
  });
  it('finds the right table cell even when cells repeat', () => {
    const doc = '| a | a |\n|---|---|\n| 0 | 0 |';
    const r = locateInline(doc, { kind: 'cell', line: 2, end: 3, content: '0', col: 1 })!;
    expect(apply(doc, { ...r, insert: '7' })).toBe('| a | a |\n|---|---|\n| 0 | 7 |');
  });
  it('refuses when the source no longer matches', () => {
    expect(locateInline('# Changed', { kind: 'heading', line: 0, end: 1, content: 'Old' })).toBe(
      null,
    );
  });
});

describe('cellRanges', () => {
  it('splits like the renderer: escaped pipes stay inside a cell', () => {
    const row = '| a \\| b | `c` |   |';
    const cells = cellRanges(row).map((r) => row.slice(r.from, r.to));
    expect(cells).toEqual(['a \\| b', '`c`', '']);
  });
});

describe('mergeInlineEdit', () => {
  it('keeps syntax the user did not touch', () => {
    // The serializer writes **bold**, the source used __bold__.
    expect(mergeInlineEdit('Some __bold__ text', 'Some **bold** text', 'Some **bold** text!')).toBe(
      'Some __bold__ text!',
    );
  });
  it('keeps untouched syntax when typing inside or right after it', () => {
    expect(
      mergeInlineEdit('Some __bold__ text', 'Some **bold** text', 'Some **bolder** text'),
    ).toBe('Some __bolder__ text');
    expect(mergeInlineEdit('Some __bold__ text', 'Some **bold** text', 'Some **bold**X text')).toBe(
      'Some __bold__X text',
    );
    expect(mergeInlineEdit('a &amp; b', 'a & b', 'a & bc')).toBe('a &amp; bc');
  });
  it('returns the serializer output when it already matches the source', () => {
    expect(mergeInlineEdit('a *b*', 'a *b*', 'a *c*')).toBe('a *c*');
  });
  it('is a no-op without changes', () => {
    expect(mergeInlineEdit('x_y', 'x\\_y', 'x\\_y')).toBe('x_y');
  });
});

describe('block operations', () => {
  it('detects block types', () => {
    expect(blockTypeOf('## a')).toBe('h2');
    expect(blockTypeOf('- [x] a')).toBe('task');
    expect(blockTypeOf('3. a')).toBe('number');
    expect(blockTypeOf('> a')).toBe('quote');
    expect(blockTypeOf('a')).toBe('paragraph');
  });
  it('changes a heading level without touching its text', () => {
    const doc = '# Title\n\nbody';
    expect(apply(doc, setBlockType(doc, 0, 1, 'h3')!)).toBe('### Title\n\nbody');
    expect(apply(doc, setBlockType(doc, 0, 1, 'paragraph')!)).toBe('Title\n\nbody');
  });
  it('turns a paragraph into a list item, keeping continuation lines inside it', () => {
    const doc = 'one\ntwo';
    expect(apply(doc, setBlockType(doc, 0, 2, 'bullet')!)).toBe('- one\n  two');
  });
  it('moves a block past its neighbour, keeping the gap', () => {
    const doc = 'A\n\nB\n\nC\n';
    const blocks = [
      { line: 0, end: 2 },
      { line: 2, end: 4 },
      { line: 4, end: 5 },
    ];
    expect(apply(doc, moveBlock(doc, blocks, 0, 1)!)).toBe('B\n\nA\n\nC\n');
    expect(apply(doc, moveBlock(doc, blocks, 2, -1)!)).toBe('A\n\nC\n\nB\n');
  });
  it('deletes a block with one following blank line', () => {
    expect(apply('A\n\nB\n\nC', deleteBlock('A\n\nB\n\nC', 2, 3))).toBe('A\n\nC');
  });
  it('finds the insertion point after a block', () => {
    expect(afterBlock('A\nB\n\nC', 3)).toBe(3);
  });
  it('finds a fenced code body and keeps the fences and language', () => {
    const doc = '```ts\nconst a = 1;\n```\nafter';
    const b = fenceBody(doc, 0, 3)!;
    expect(b.info).toBe('ts');
    expect(doc.slice(b.from, b.to)).toBe('const a = 1;');
    const empty = '```\n```';
    const e = fenceBody(empty, 0, 2)!;
    expect(e.empty).toBe(true);
    expect(apply(empty, { from: e.from, to: e.to, insert: 'x\n' })).toBe('```\nx\n```');
  });
});
