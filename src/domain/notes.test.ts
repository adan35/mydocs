import { describe, expect, it } from 'vitest';
import {
  emptyNote,
  masonry,
  matchesFilter,
  neighborInDirection,
  nextReminder,
  noteFileName,
  orderFor,
  orderOnTop,
  parseNote,
  serializeNote,
  toggleChecklist,
  type NoteData,
} from './notes';

const note = (patch: Partial<NoteData>): NoteData => ({ ...emptyNote(), ...patch });

describe('note files', () => {
  it('round-trips a text note with images and settings', () => {
    const n = note({
      title: 'Plan',
      text: 'Line one\n\nLine two',
      images: ['assets/a%20b.png', 'assets/c.png'],
      color: 'mint',
      pinned: true,
      archived: true,
      labels: ['work', 'ideas'],
      reminder: Date.UTC(2026, 9, 27, 9, 0),
      repeat: 'weekly',
      order: -5,
    });
    expect(parseNote(serializeNote(n))).toEqual(n);
  });

  it('round-trips a checklist and keeps unrelated front matter', () => {
    const n = note({
      items: [
        { text: 'milk', done: false },
        { text: 'eggs', done: true },
      ],
    });
    const first = serializeNote(n, '---\nauthor: me\n---\nold');
    expect(first).toContain('author: me');
    expect(first).toContain('- [ ] milk\n- [x] eggs');
    expect(parseNote(first)).toMatchObject({ items: n.items, text: '' });
  });

  it('reads plain Markdown files as text notes', () => {
    expect(parseNote('# Heading\n\nHello')).toMatchObject({
      title: '',
      text: '# Heading\n\nHello',
    });
  });

  it('ignores bad front matter values', () => {
    const n = parseNote('---\ncolor: purple\nreminder: soon\nrepeat: hourly\norder: x\n---\nhi');
    expect(n).toMatchObject({ color: 'default', reminder: null, repeat: null, order: null });
  });

  it('converts between text and checklist', () => {
    const list = toggleChecklist(note({ text: 'a\n\nb' }));
    expect(list.items).toEqual([
      { text: 'a', done: false },
      { text: 'b', done: false },
    ]);
    expect(toggleChecklist(note({ items: list.items })).text).toBe('a\nb');
  });

  it('names files from the title, the first line or the time', () => {
    expect(noteFileName(note({ title: 'A/B' }))).toBe('A-B.md');
    expect(noteFileName(note({ text: 'Buy milk\nand eggs' }))).toBe('Buy milk.md');
    expect(noteFileName(note({}), new Date(2026, 9, 5, 7, 3))).toBe('Note 2026-10-05 07.03.md');
  });
});

describe('ordering', () => {
  const list = [
    { id: 'a', order: 1, createdAt: 0 },
    { id: 'b', order: 2, createdAt: 0 },
    { id: 'c', order: null, createdAt: 1000 },
  ];
  it('inserts between neighbours and at the ends', () => {
    expect(orderFor(list, 'c', 'b', false)).toBe(1.5);
    expect(orderFor(list, 'a', 'b', true)).toBeGreaterThan(2);
    expect(orderFor(list, 'b', 'a', false)).toBeLessThan(1);
  });
  it('puts a note on top', () => {
    expect(orderOnTop(list)).toBeLessThan(-1000);
  });
});

describe('filter', () => {
  const n = note({ title: 'Trip', items: [{ text: 'passport', done: false }], labels: ['travel'] });
  it('matches every term across title, items and labels', () => {
    expect(matchesFilter(n, { query: 'trip pass' })).toBe(true);
    expect(matchesFilter(n, { query: 'trip nothing' })).toBe(false);
    expect(matchesFilter(n, { query: '', lists: true, label: 'travel' })).toBe(true);
    expect(matchesFilter(n, { query: '', images: true })).toBe(false);
  });
});

describe('reminders and layout', () => {
  it('repeats past the reference time', () => {
    const from = Date.UTC(2026, 0, 1, 9);
    expect(nextReminder(from, 'daily', Date.UTC(2026, 0, 3, 12))).toBe(Date.UTC(2026, 0, 4, 9));
  });
  it('balances columns by height', () => {
    const cols = masonry([100, 100, 30, 30, 30], 2, (h) => h);
    expect(cols.map((c) => c.length)).toEqual([3, 2]);
  });
});

describe('arrow navigation', () => {
  // Two columns: a tall card on the left, two short ones on the right.
  const boxes = [
    { left: 0, top: 0, width: 100, height: 300 },
    { left: 112, top: 0, width: 100, height: 100 },
    { left: 112, top: 112, width: 100, height: 100 },
  ];
  it('moves to the nearest card in each direction', () => {
    expect(neighborInDirection(boxes, 0, 'right')).toBe(2);
    expect(neighborInDirection(boxes, 1, 'down')).toBe(2);
    expect(neighborInDirection(boxes, 2, 'up')).toBe(1);
    expect(neighborInDirection(boxes, 2, 'left')).toBe(0);
  });
  it('stays put at the edges', () => {
    expect(neighborInDirection(boxes, 0, 'left')).toBeUndefined();
    expect(neighborInDirection(boxes, 1, 'up')).toBeUndefined();
  });
});
