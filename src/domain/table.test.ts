import { describe, expect, it } from 'vitest';
import { cleanCell, findTable, parseTable, serializeTable, splitRow, tableOps } from './table';

const src = [
  'Intro',
  '',
  '| Name | Score | Note |',
  '| :--- | ---: | :-: |',
  '| Ada | 10 | uses `a|b` |',
  '| Bob | 7 | x \\| y |',
  '',
  'After',
];

describe('tables', () => {
  it('finds the table around a line', () => {
    expect(findTable(src, 4)).toEqual({ start: 2, end: 5 });
    expect(findTable(src, 2)).toEqual({ start: 2, end: 5 });
    expect(findTable(src, 0)).toBeNull();
    expect(findTable(['a | b', 'not a table'], 0)).toBeNull();
  });

  it('parses cells, alignment, escaped pipes and code', () => {
    const t = parseTable(src.slice(2, 6))!;
    expect(t.header).toEqual(['Name', 'Score', 'Note']);
    expect(t.align).toEqual(['left', 'right', 'center']);
    expect(t.rows[0]).toEqual(['Ada', '10', 'uses `a|b`']);
    expect(t.rows[1]).toEqual(['Bob', '7', 'x \\| y']);
    expect(splitRow('a | b')).toEqual(['a', 'b']);
  });

  it('round-trips through serialize and stays a valid table', () => {
    const t = parseTable(src.slice(2, 6))!;
    const out = serializeTable(t);
    const again = parseTable(out.split('\n'))!;
    expect(again.align).toEqual(t.align);
    expect(again.rows[1]).toEqual(['Bob', '7', 'x \\| y']);
    expect(out.split('\n')[1]).toMatch(/^\| :-+ \| -+: \| :-+: \|$/);
  });

  it('edits rows and columns immutably', () => {
    let t = parseTable(src.slice(2, 6))!;
    t = tableOps.insertColumn(t, 1);
    expect(t.header).toHaveLength(4);
    t = tableOps.moveColumn(t, 0, 1);
    expect(t.header[1]).toBe('Name');
    t = tableOps.deleteColumn(t, 0);
    t = tableOps.insertRow(t, 0);
    expect(t.rows[0]).toEqual(['', '', '']);
    t = tableOps.moveRow(t, 0, 2);
    expect(t.rows[2]).toEqual(['', '', '']);
    t = tableOps.setCell(t, -1, 0, 'Who');
    expect(t.header[0]).toBe('Who');
  });

  it('keeps cells on one line and escapes pipes', () => {
    expect(cleanCell('a\nb|c||d \\| e')).toBe('a b\\|c\\|\\|d \\| e');
  });
});
